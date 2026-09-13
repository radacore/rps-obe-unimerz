from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from docx import Document
from docx.shared import Pt, Emu
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from io import BytesIO
import copy
import json
import pathlib
import re

app = FastAPI(title="RPS DOCX Service")

TEMPLATE_PATH = pathlib.Path(__file__).parent / "template.docx"


class DocxAnchorError(RuntimeError):
    """Raised when an expected anchor (heading/label) is missing from template.docx.

    Anchors are resolved by their visible label, never by a frozen index, so a
    template revision surfaces as a loud 500 instead of silently writing text
    into the wrong row.
    """


class _ParaRef:
    """Minimal stand-in exposing ._p so freshly inserted w:p can be chained."""

    def __init__(self, p_element):
        self._p = p_element


def _as_list(raw) -> list:
    """Coerce payload field (list | JSON string | scalar | None) into a list."""
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return [raw]
        return parsed if isinstance(parsed, list) else [parsed]
    return [raw]

# ---------------------------------------------------------------------------
# helpers: preserve w:sz/w:szCs etc from template run, inject Times 9pt if needed
# ---------------------------------------------------------------------------
SZ = 18          # 9pt = 18 half-points
SZ_11 = 22       # 11pt for some header rows
FONT = "Times New Roman"

def _ensure_fonts(rPr, font=FONT):
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts'); rPr.append(rFonts)
    for a in ('ascii', 'hAnsi', 'cs', 'eastAsia'):
        rFonts.set(qn(f'w:{a}'), font)

def _set_sz(rPr, half_pt: int):
    for tag in ('w:sz', 'w:szCs'):
        el = rPr.find(qn(tag))
        if el is None:
            el = OxmlElement(tag); rPr.append(el)
        el.set(qn('w:val'), str(half_pt))

def _first_rPr(call):
    """Return rPr of first run in cell, or None."""
    if not call.paragraphs: return None
    if not call.paragraphs[0].runs: return None
    return call.paragraphs[0].runs[0]._r.get_or_add_rPr()

def _cell_style_ref(cell):
    """Pick half-pt from existing cell's first run (fallback SZ)."""
    rPr = _first_rPr(cell)
    if rPr is None: return SZ
    sz = rPr.find(qn('w:sz'))
    if sz is not None:
        try: return int(sz.get(qn('w:val')))
        except (TypeError, ValueError): return SZ
    return SZ

def set_cell_text(cell, text: str, *, bold: bool | None = None, sz: int | None = None, preserve_sz: bool = True):
    """
    Replace cell text while preserving paragraph/alias. Need to keep pPr (jc/shd) intact,
    clear runs and re-add one run cloned from original rPr so fonts/alignment keep.
    NOTE: For weekly rows, prefer set_tc_text() via lxml tc index because
    python-docx row.cells duplicates merged cells (gridSpan -> 13 cells for 8 tc).
    This helper is kept for simple single-cell tables (tbl1 etc) and for R03/R05
    where duplication is not relied upon for data isolation.
    """
    # Remember original alignment on paragraph
    orig_align = cell.paragraphs[0].alignment if cell.paragraphs else None
    # Capture reference rPr attrs to clone
    ref_rPr = None
    if cell.paragraphs and cell.paragraphs[0].runs:
        ref_rPr = cell.paragraphs[0].runs[0]._r.find(qn('w:rPr'))
    orig_sz = None
    if preserve_sz and ref_rPr is not None:
        sz_el = ref_rPr.find(qn('w:sz'))
        if sz_el is not None: orig_sz = sz_el.get(qn('w:val'))

    # Clear paragraph content (keep pPr)
    p = cell.paragraphs[0]._p if cell.paragraphs else None
    par = cell.paragraphs[0] if cell.paragraphs else None
    if par is None:
        par = cell.add_paragraph()
        run = par.add_run(text)
        run.font.name = FONT
        _set_sz(run._r.get_or_add_rPr(), sz if sz is not None else SZ)
        _ensure_fonts(run._r.get_or_add_rPr())
        if bold is not None: run.bold = bool(bold)
        return run

    for r in list(par.runs):
        r._r.getparent().remove(r._r)
    if not text and text != "0":
        if orig_align is not None: par.alignment = orig_align
        return None
    run = par.add_run(text)
    rPr = run._r.get_or_add_rPr()
    if ref_rPr is not None:
        rf = ref_rPr.find(qn('w:rFonts'))
        if rf is not None:
            new_rf = OxmlElement('w:rFonts')
            for k,v in rf.attrib.items(): new_rf.set(k, v)
            existing = rPr.find(qn('w:rFonts'))
            if existing is not None: existing.getparent().remove(existing)
            rPr.append(new_rf)
        else:
            _ensure_fonts(rPr)
    else:
        _ensure_fonts(rPr)
    target_sz = sz if sz is not None else (int(orig_sz) if orig_sz else SZ)
    _set_sz(rPr, target_sz)
    _ensure_fonts(rPr, FONT)
    run.font.name = FONT
    if bold is not None: run.bold = bool(bold)
    if orig_align is not None: par.alignment = orig_align
    return run


def set_tc_text(tr_element, tc_idx: int, text: str, *, bold: bool | None = None):
    """Set text on lxml w:tr -> w:tc[tc_idx] preserving pPr/shd and first run's sz/rFonts.
    Template weekly cells have multiple w:p (bullets). We collapse to single paragraph to avoid leftover concatenation.
    """
    tcs = tr_element.findall(qn('w:tc'))
    if tc_idx >= len(tcs):
        return None
    tc = tcs[tc_idx]
    ps = tc.findall(qn('w:p'))
    if not ps:
        p = OxmlElement('w:p')
        tc.append(p)
        ps = [p]
    # Capture original sz/rFonts from first paragraph's first run
    orig_sz = SZ
    orig_rFonts_attrs = None
    first_r = ps[0].find(qn('w:r'))
    if first_r is not None:
        rPr0 = first_r.find(qn('w:rPr'))
        if rPr0 is not None:
            sz_el = rPr0.find(qn('w:sz'))
            if sz_el is not None:
                try:
                    orig_sz = int(sz_el.get(qn('w:val')))
                except (TypeError, ValueError):
                    pass
            rf = rPr0.find(qn('w:rFonts'))
            if rf is not None:
                orig_rFonts_attrs = dict(rf.attrib)
    # Keep first paragraph, remove all extra paragraphs
    for extra in ps[1:]:
        tc.remove(extra)
    p = ps[0]
    # Keep pPr (alignment/shd), remove all r/hyperlink etc but keep pPr
    for child in list(p):
        # keep w:pPr
        if child.tag == qn('w:pPr'):
            continue
        p.remove(child)
    if not text and text != "0":
        # A cleared cell must also drop its numbering, otherwise Word still
        # renders the bullet/number for an empty line.
        pPr = p.find(qn('w:pPr'))
        if pPr is not None:
            numPr = pPr.find(qn('w:numPr'))
            if numPr is not None:
                pPr.remove(numPr)
        return None
    r_el = OxmlElement('w:r')
    rPr = OxmlElement('w:rPr')
    _set_sz(rPr, orig_sz)
    if orig_rFonts_attrs is not None:
        rf_new = OxmlElement('w:rFonts')
        for k, v in orig_rFonts_attrs.items():
            rf_new.set(k, v)
        rPr.append(rf_new)
    else:
        _ensure_fonts(rPr, FONT)
    if rPr.find(qn('w:rFonts')) is None:
        _ensure_fonts(rPr, FONT)
    if bold:
        b = OxmlElement('w:b'); rPr.append(b)
        bCs = OxmlElement('w:bCs'); rPr.append(bCs)
    r_el.append(rPr)
    t_el = OxmlElement('w:t')
    t_el.text = text
    if text and (text[0] == " " or text[-1] == " "):
        t_el.set(qn('xml:space'), 'preserve')
    r_el.append(t_el)
    p.append(r_el)
    return r_el


def tc_text(tc) -> str:
    """Concatenate all w:t inside a w:tc, newline per w:p."""
    lines = []
    for p in tc.findall(qn('w:p')):
        lines.append("".join(
            "".join(t.text or "" for t in r.findall(qn('w:t')))
            for r in p.findall(qn('w:r'))
        ))
    return "\n".join(lines).strip()


def tr_cell_text(tr, tc_idx: int) -> str:
    tcs = tr.findall(qn('w:tc'))
    if tc_idx >= len(tcs):
        return ""
    return tc_text(tcs[tc_idx])


def _flat(s: str) -> str:
    """Normalise whitespace + case for label matching."""
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def remove_paragraph(p) -> None:
    """Lepas w:p dari induknya.

    Diperlukan karena mengosongkan teks saja meninggalkan numPr, yang tetap
    tercetak sebagai bullet/nomor menggantung di Word.

    Paragraf yang membawa w:sectPr tidak dihapus, hanya dikosongkan: elemen itu
    mendefinisikan ukuran/orientasi/margin section, dan membuangnya membuat
    halaman berikutnya mewarisi tata letak yang salah.
    """
    pPr = p.find(qn('w:pPr'))
    if pPr is not None and pPr.find(qn('w:sectPr')) is not None:
        for child in list(p):
            if child.tag != qn('w:pPr'):
                p.remove(child)
        numPr = pPr.find(qn('w:numPr'))
        if numPr is not None:
            pPr.remove(numPr)
        return
    parent = p.getparent()
    if parent is not None:
        parent.remove(p)


def split_profile_items(raw) -> list[str]:
    """Normalise graduate-profile entries into one item per list element.

    Only the "Label: description" shape can be split reliably. A bare run of
    role names ("Systems Analyst Database Administrator ...") has no recoverable
    boundary — guessing produces garbage like "IT Trainer" -> "I" + "T Trainer" —
    so such an entry is kept intact and must be fixed in the catalog instead.
    """
    # Leftmost-greedy so "Health Educator & Promoter:" is one label, not two.
    label_re = re.compile(r"(?:[A-Z][A-Za-z&/]*[ ]){0,4}[A-Z][A-Za-z&/]*[ ]*:")
    items: list[str] = []
    for entry in _as_list(raw):
        s = re.sub(r"\s+", " ", str(entry or "")).strip()
        if not s:
            continue
        starts = [m.start() for m in label_re.finditer(s)]
        if len(starts) > 1:
            bounds = starts + [len(s)]
            items.extend(
                chunk for chunk in (
                    s[bounds[i]:bounds[i + 1]].strip() for i in range(len(starts))
                ) if chunk
            )
        else:
            items.append(s)
    return items


def _lines(values) -> str:
    """Join a list-ish payload field into newline-separated text."""
    return "\n".join(str(x) for x in _as_list(values) if str(x).strip())


def _norm_lecturers(raw):
    # raw can be list or JSON string
    if isinstance(raw, str):
        try: raw = json.loads(raw)
        except json.JSONDecodeError: raw = []
    if not isinstance(raw, list): raw = []
    out=[]
    for item in raw:
        if not isinstance(item, dict): continue
        out.append({"name": str(item.get("name","")).strip(), "nidn": str(item.get("nidn","")).strip(), "role": str(item.get("role","")).strip()})
    return out

def _ensure_lecturers(lecturers):
    """Guarantee at least 1 koordinator_mk."""
    if not lecturers: return lecturers
    if not any(l.get("role")=="koordinator_mk" for l in lecturers):
        lecturers[0]["role"]="koordinator_mk"
    return lecturers

def _split_by_role(lecturers):
    """Return dict role->name for Otorisasi: pengembang, koordinator_mk, ketua_prodi."""
    d={}
    for l in lecturers:
        r=l.get("role")
        if r in ("pengembang","koordinator_mk","ketua_prodi") and r not in d:
            d[r]=l.get("name","")
    return d

def _join_all_names(lecturers):
    return "\n".join(l.get("name","") for l in lecturers if l.get("name",""))

def _format_date(raw):
    if not raw: return "28 Juni 2025"
    s=str(raw)[:10]
    try:
        from datetime import date
        d=date.fromisoformat(s)
        bulan=["","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"]
        return f"{d.day} {bulan[d.month]} {d.year}"
    except ValueError: return s

# Canonical 9 variabel 16 minggu (R35-R43)
CANONICAL_WEEKLY = [
    {"week":"1", "weight":5,  "is_merged": False},
    {"week":"2", "weight":5,  "is_merged": False},
    {"week":"3, 4", "weight":10, "is_merged": False},
    {"week":"5, 6, 7", "weight":20, "is_merged": False},
    {"week":"8", "weight":0,  "is_merged": True,  "material":"UJIAN MID SEMESTER"},
    {"week":"9, 10, 11", "weight":30, "is_merged": False},
    {"week":"12, 13", "weight":10, "is_merged": False},
    {"week":"14, 15", "weight":20, "is_merged": False},
    {"week":"16", "weight":0,  "is_merged": True,  "material":"UJIAN FINAL SEMESTER"},
]

def _normalize_weekly(weekly_plans):
    """Ensure 9 rows with canonical weights/is_merged; merge passed material when available."""
    if not weekly_plans or not isinstance(weekly_plans, list):
        weekly_plans = CANONICAL_WEEKLY
    # pad/truncate to 9? But trust AI 9. If not 9, coerce.
    if len(weekly_plans) != 9:
        # Try to map by weight/merge if shorter; prefer fill with canonical
        # Keep existing up to 9, pad rest
        padded = []
        for i in range(9):
            if i < len(weekly_plans):
                padded.append(weekly_plans[i])
            else:
                padded.append(dict(CANONICAL_WEEKLY[i]))
        weekly_plans = padded
    # enforce canonical merge rows
    for i, can in enumerate(CANONICAL_WEEKLY):
        if can.get("is_merged"):
            weekly_plans[i]["is_merged"] = True
            # ensure label upper
            if not weekly_plans[i].get("material") or "UJIAN" not in str(weekly_plans[i].get("material","")).upper():
                weekly_plans[i]["material"] = can["material"]
            weekly_plans[i]["weight"] = 0
        else:
            weekly_plans[i]["is_merged"] = False
            weekly_plans[i]["weight"] = can["weight"]
    return weekly_plans

@app.get("/health")
async def health():
    return {"status": "ok", "service": "docx"}

@app.get("/")
async def root():
    return {"status": "ok"}

@app.post("/generate")
async def generate(request: Request):
    body = await request.json()
    draft = body.get("rps_draft") or body.get("rpsDraft") or body

    course_code = draft.get("course_code") or draft.get("courseCode") or ""
    course_name = draft.get("course_name") or draft.get("courseName") or ""
    sks_total = draft.get("sks_total") or draft.get("sksTotal") or 4
    sks_theory = draft.get("sks_theory") or draft.get("sksTheory") or 3
    sks_practice = draft.get("sks_practice") or draft.get("sksPractice") or 1
    semester = draft.get("semester") or "I"
    preparation_date = draft.get("preparation_date") or draft.get("preparationDate") or ""
    # Tanpa default prodi/fakultas: menebak "Keperawatan" di sini berarti dokumen
    # untuk prodi lain diam-diam terbit dengan identitas yang salah.
    faculty = draft.get("faculty") or draft.get("faculty_label") or ""
    study_program = draft.get("study_program") or draft.get("studyProgram") or draft.get("prodi") or ""
    lecturers_raw = _as_list(draft.get("lecturers"))
    weekly_raw = _as_list(draft.get("weekly_plans") or draft.get("weeklyPlans"))
    cpl = _as_list(draft.get("cpl"))
    cpmk = _as_list(draft.get("cpmk"))
    sub_cpmk = _as_list(draft.get("sub_cpmk") or draft.get("subCpmk"))

    lecturers = _ensure_lecturers(_norm_lecturers(lecturers_raw))
    weekly_plans = _normalize_weekly(weekly_raw)

    # ------------------------------------------------------------------
    # Load template docx (preserves 6 sectPr, 4 tbl, gridCol, Times New Roman,
    # images, footer, styles, numbering etc.) — 100% fidelity
    # ------------------------------------------------------------------
    if not TEMPLATE_PATH.exists():
        # fallback: synthetic (should not happen)
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "template.docx not found"}, status_code=500)

    doc = Document(str(TEMPLATE_PATH))

    # --------------------------------------------------------------
    # Cover outside tables: P20 Prodi, P21 Fakultas — dinamis per Unimerz
    # --------------------------------------------------------------
    def _set_para_text(p, text: str, *, size: int = 11, bold: bool = True):
        for r in list(p.runs):
            r._r.getparent().remove(r._r)
        run = p.add_run(text)
        run.font.size = Pt(size); run.font.name = FONT; run.bold = bold
        return run
    def _prodi_display(raw: str) -> str:
        s = str(raw or "").strip()
        if not s: return s
        up = s.upper()
        if up.startswith("PROGRAM STUDI") or up.startswith("PROFESI") or up.startswith("MAGISTER"):
            return up
        if s.startswith("S1 ") or s.startswith("S2 ") or s.startswith("D3 ") or s.startswith("D4 "):
            return f"PROGRAM STUDI {up}"
        return up
    def _normalise_ws(s: str) -> str:
        return re.sub(r"\s+", " ", s.strip())

    # Sampul: baris prodi/fakultas dikenali dari prefiks strukturalnya
    # ("PROGRAM STUDI ...", "FAKULTAS ...", "MATA KULIAH ..."), bukan dari kata
    # "KEPERAWATAN". Deteksi berbasis isi template membuat penggantian mati
    # senyap begitu template diganti versi prodi lain.
    cover_prodi = _prodi_display(study_program)
    cover_faculty = str(faculty or "").strip().upper()
    if cover_faculty and not (cover_faculty.startswith("FAKULTAS") or cover_faculty.startswith("PROGRAM PASCASARJANA")):
        cover_faculty = f"FAKULTAS {cover_faculty}"
    cover_course = str(course_name or "").strip().upper()

    for p in doc.paragraphs:
        txt_up = _normalise_ws(p.text or "").upper()
        if not txt_up:
            continue
        if txt_up.startswith("PROGRAM STUDI") and cover_prodi:
            _set_para_text(p, cover_prodi, size=11, bold=True)
        elif txt_up.startswith("FAKULTAS") and cover_faculty:
            _set_para_text(p, cover_faculty, size=11, bold=True)
        elif txt_up.startswith("MATA KULIAH") and cover_course and "(MK)" not in txt_up:
            _set_para_text(p, f"MATA KULIAH \u2013 {cover_course}", size=11, bold=True)

    # --- Narasi sampul: Visi / Misi / Profil Lulusan / CPL-PRODI (luar tabel) ---
    # Blok ini diisi per-prodi dari katalog. Item surplus milik template DIHAPUS
    # (bukan dikosongkan) supaya numPr tidak meninggalkan bullet/nomor menggantung.
    prog_vision = draft.get("program_vision") or draft.get("programVision") or ""
    prog_mission = _as_list(draft.get("program_mission") or draft.get("programMission"))
    prog_profile = _as_list(draft.get("program_graduate_profile") or draft.get("programGraduateProfile"))
    prog_cpl = _as_list(draft.get("program_cpl") or draft.get("programCpl"))

    SECTION_FLAGS = ("visi", "misi", "profil lulusan", "capaian pembelajaran lulusan",
                     "analisis pembelajaran", "catatan")

    def _find_heading(flag: str) -> int:
        target = _flat(flag)
        for idx, pp in enumerate(doc.paragraphs):
            if _flat(pp.text) == target:
                return idx
        return -1

    def _body_paragraphs(head_idx: int, limit: int = 14):
        """Paragraf isi setelah heading, berhenti di heading berikutnya.

        Paragraf kosong yang masih membawa numPr ikut dihitung sebagai item:
        template menyimpan beberapa list item kosong, dan kalau dilewati ia
        tertinggal sebagai nomor menggantung di dokumen hasil.
        """
        out = []
        if head_idx < 0:
            return out
        for j in range(head_idx + 1, len(doc.paragraphs)):
            pp = doc.paragraphs[j]
            t = (pp.text or "").strip()
            pPr = pp._p.find(qn('w:pPr'))
            numbered = pPr is not None and pPr.find(qn('w:numPr')) is not None
            if not t and not numbered:
                continue
            if _flat(t) in SECTION_FLAGS:
                break
            out.append(pp)
            if len(out) >= limit:
                break
        return out

    def _clone_para_after(ref_p, text: str):
        """Duplikat paragraf referensi (bawa pPr incl. numPr) lalu isi teks baru."""
        new_p = copy.deepcopy(ref_p._p)
        for child in list(new_p):
            if child.tag != qn('w:pPr'):
                new_p.remove(child)
        # Paragraf terakhir sebuah section menyimpan w:sectPr di dalam pPr-nya.
        # Menyalinnya akan menambah section baru dan memecah tata letak halaman
        # (ukuran/orientasi/margin) dokumen hasil.
        pPr = new_p.find(qn('w:pPr'))
        if pPr is not None:
            sect = pPr.find(qn('w:sectPr'))
            if sect is not None:
                pPr.remove(sect)
        r_el = OxmlElement('w:r')
        rPr = OxmlElement('w:rPr')
        _set_sz(rPr, 20)
        _ensure_fonts(rPr, FONT)
        r_el.append(rPr)
        t_el = OxmlElement('w:t')
        t_el.text = text
        r_el.append(t_el)
        new_p.append(r_el)
        ref_p._p.addnext(new_p)
        return new_p

    def _fill_block(head_flag: str, items: list[str], *, title: str | None = None) -> None:
        """Tulis items ke paragraf isi di bawah heading.

        Paragraf sisa milik template dihapus. Bila items kosong, seluruh isi
        blok dihapus juga — membiarkannya berarti narasi prodi lain tetap
        tercetak untuk prodi yang datanya belum lengkap.
        """
        values = [v for v in ([title] + list(items) if title else list(items)) if str(v).strip()]
        head_idx = _find_heading(head_flag)
        if head_idx < 0:
            raise DocxAnchorError(f"heading '{head_flag}' tidak ditemukan di template")
        bodies = _body_paragraphs(head_idx)
        if not bodies:
            raise DocxAnchorError(f"paragraf isi untuk '{head_flag}' tidak ditemukan")
        for k, pp in enumerate(bodies):
            if k < len(values):
                _set_para_text(pp, str(values[k]).strip(), size=10, bold=False)
            else:
                remove_paragraph(pp._p)
        if len(values) > len(bodies):
            anchor = bodies[-1]
            for extra in values[len(bodies):]:
                anchor = _ParaRef(_clone_para_after(anchor, str(extra).strip()))

    try:
        _fill_block("Visi", [prog_vision.strip()] if isinstance(prog_vision, str) else [])
        _fill_block("Misi", [str(x).strip() for x in prog_mission])
        prodi_label = str(study_program or "Program Studi").strip()
        profile_items = split_profile_items(prog_profile)
        _fill_block(
            "Profil Lulusan",
            profile_items,
            title=f"Profil lulusan {prodi_label}:" if profile_items else None,
        )
        cpl_lines = []
        for item in prog_cpl:
            if isinstance(item, dict):
                cpl_lines.append(str(item.get("description") or item.get("desc") or "").strip())
            else:
                cpl_lines.append(str(item).strip())
        _fill_block("Capaian Pembelajaran Lulusan", [x for x in cpl_lines if x])
    except DocxAnchorError as exc:
        print(f"[docx] anchor narasi gagal: {exc}")
        raise

    # --------------------------------------------------------------
    # TBL0 -- 44x13 main
    # Indices via inspection: see earlier dump
    # We replace content in place, preserving gridSpan/vMerge/shd
    # --------------------------------------------------------------
    tbl0 = doc.tables[0]  # 44 rows

    # Resolve tbl0 rows by their visible label instead of a frozen index, so a
    # template edit fails loudly (DocxAnchorError) rather than writing into the
    # wrong row. Offsets are relative to a labelled anchor row.
    def _row_by_label(table, label: str, *, tc_idx: int = 0, contains: bool = False):
        target = _flat(label)
        for row in table.rows:
            cell = tr_cell_text(row._tr, tc_idx)
            flat = _flat(cell)
            if (target in flat) if contains else (flat == target):
                return row._tr
        raise DocxAnchorError(f"baris berlabel '{label}' tidak ditemukan (tbl kolom {tc_idx})")

    def _row_index_by_label(table, label: str, *, tc_idx: int = 0, contains: bool = False) -> int:
        target = _flat(label)
        for idx, row in enumerate(table.rows):
            flat = _flat(tr_cell_text(row._tr, tc_idx))
            if (target in flat) if contains else (flat == target):
                return idx
        raise DocxAnchorError(f"baris berlabel '{label}' tidak ditemukan (tbl kolom {tc_idx})")

    def _rows_after(table, label: str, count: int, *, tc_idx: int = 0, contains: bool = False):
        start = _row_index_by_label(table, label, tc_idx=tc_idx, contains=contains) + 1
        return [table.rows[start + i]._tr for i in range(count) if start + i < len(table.rows)]

    # Baris kop: "Universitas Megarezky / Fakultas X / Program Studi Y".
    # Dipakai dua kali — tbl0 (RPS) dan tbl1 (RTM) — supaya keduanya sinkron.
    fakultas_line = str(faculty or "").strip()
    if fakultas_line and not (fakultas_line.startswith("Fakultas") or fakultas_line.startswith("Program Pascasarjana")):
        fakultas_line = f"Fakultas {fakultas_line}"
    display_prodi = str(study_program or "").strip()
    if display_prodi[:3] in ("S1 ", "S2 ", "S3 ", "D3 ", "D4 ") and not display_prodi.startswith("Program Studi"):
        display_prodi = f"Program Studi {display_prodi}"
    kop_lines = "\n".join(x for x in ("Universitas Megarezky", fakultas_line, display_prodi) if x)

    tr00 = _row_by_label(tbl0, "Kode Dokumen", tc_idx=2)
    set_tc_text(tr00, 1, kop_lines)

    # Baris identitas MK: 7 tc (0 nama gs3, 1 kode gs2, 2 rumpun gs2, 3 T, 4 P, 5 semester, 6 tgl gs3)
    # Anchor = baris header "MATA KULIAH (MK)" tepat di atasnya.
    tr03 = _rows_after(tbl0, "MATA KULIAH (MK)", 1)[0]
    rumpun = draft.get("course_cluster") or draft.get("courseCluster") or str(study_program or "").strip()
    set_tc_text(tr03, 0, str(course_name))
    set_tc_text(tr03, 1, str(course_code))
    set_tc_text(tr03, 2, str(rumpun))
    set_tc_text(tr03, 3, f"T={sks_theory}")
    set_tc_text(tr03, 4, f"P={sks_practice}")
    set_tc_text(tr03, 5, str(semester))
    set_tc_text(tr03, 6, _format_date(preparation_date))

    # Baris nama penandatangan Otorisasi: 4 tc — tc1 pengembang, tc2 koordinator, tc3 ketua prodi.
    # Nama yang tidak dipasok dikosongkan supaya nama dosen template tidak tertinggal.
    tr05 = _rows_after(tbl0, "OTORISASI", 1)[0]
    by_role = _split_by_role(lecturers)
    set_tc_text(tr05, 1, by_role.get("pengembang") or "")
    set_tc_text(tr05, 2, by_role.get("koordinator_mk") or "")
    set_tc_text(tr05, 3, by_role.get("ketua_prodi") or "")
    # Baris "Tim Pengajar" di sampul: nama dosen menyusul satu paragraf di bawahnya.
    tim_idx = next(
        (i for i, pp in enumerate(doc.paragraphs) if (pp.text or "").strip().startswith("Tim Pengajar")),
        -1,
    )
    if tim_idx == -1:
        raise DocxAnchorError("paragraf 'Tim Pengajar' tidak ditemukan di template")
    if lecturers and tim_idx + 1 < len(doc.paragraphs):
        ROLE_SUFFIX = {
            "koordinator_mk": " – (Koordinator)",
            "ketua_prodi": " – (Ketua Prodi)",
            "pengembang": " – (Pengembang)",
        }
        parts = [
            f"{(l.get('name') or '').strip()}{ROLE_SUFFIX.get(l.get('role') or '', '')}"
            for l in lecturers if (l.get("name") or "").strip()
        ]
        if parts:
            _set_para_text(doc.paragraphs[tim_idx + 1], ", ".join(parts), size=11, bold=False)

    # ---- CP section (CPL / CPMK / Sub-CPMK) ----
    # Tiap baris punya 3 tc [2,1,10]: header vMerge, kode, deskripsi.
    # Baris dianchor dari header di kolom tengah, bukan indeks tetap.
    # Bila payload memuat key-nya (walau kosong), baris sisa dikosongkan agar
    # isi template (prodi lain) tidak ikut terbawa.
    def _clone_row_after(tr_element):
        """Duplikat baris tabel beserta properti sel (gridSpan/vMerge/shd)."""
        new_tr = copy.deepcopy(tr_element)
        # Kosongkan teks; strukturnya yang dipertahankan, bukan isinya.
        for tc in new_tr.findall(qn('w:tc')):
            for p in tc.findall(qn('w:p')):
                for child in list(p):
                    if child.tag != qn('w:pPr'):
                        p.remove(child)
        tr_element.addnext(new_tr)
        return new_tr

    def _fill_cp_rows(anchor_label: str, count: int, items: list, key_present: bool, default_code) -> None:
        rows = _rows_after(tbl0, anchor_label, count, tc_idx=1, contains=True)
        # Template menyediakan jumlah baris tetap (2 CPL, 4 CPMK, 7 Sub-CPMK).
        # Kurikulum nyata bisa melebihinya, dan membiarkan sisanya terpotong
        # berarti CPL/CPMK hilang dari dokumen tanpa peringatan apa pun.
        while len(rows) < len(items):
            rows.append(_clone_row_after(rows[-1]))
        for idx, tr in enumerate(rows):
            if idx < len(items):
                item = items[idx] if isinstance(items[idx], dict) else {}
                code = item.get("code") or default_code(idx)
                desc = item.get("description") or item.get("desc") or ""
                set_tc_text(tr, 1, str(code))
                set_tc_text(tr, 2, str(desc))
            elif key_present:
                set_tc_text(tr, 1, "")
                set_tc_text(tr, 2, "")

    _fill_cp_rows("CPL-PRODI", 2, cpl, "cpl" in draft, lambda i: f"CPL{i+1}")
    _fill_cp_rows("Capaian Pembelajaran Mata Kuliah", 4, cpmk, "cpmk" in draft, lambda i: f"CPMK {i+1}")
    _fill_cp_rows("Sub-CPMK", 7, sub_cpmk, ("sub_cpmk" in draft or "subCpmk" in draft), lambda i: f"Sub-CPMK-{i+1}")

    # Deskripsi Singkat MK & Bahan Kajian — label ada di tc0, isi di tc1.
    desc_present = any(k in draft for k in ("description", "deskripsi", "short_description"))
    desc_value = ""
    for key in ("description", "deskripsi", "short_description"):
        if key in draft:
            desc_value = draft.get(key) or ""
            break
    if desc_present or desc_value:
        set_tc_text(_row_by_label(tbl0, "Deskripsi Singkat MK"), 1, str(desc_value).strip())

    bahan_present = any(k in draft for k in ("bahan_kajian", "bahanKajian"))
    if bahan_present:
        bahan = _as_list(draft.get("bahan_kajian") if "bahan_kajian" in draft else draft.get("bahanKajian"))
        bahan_txt = "\n".join(str(x) for x in bahan if str(x).strip())
        set_tc_text(_row_by_label(tbl0, "Bahan Kajian", contains=True), 1, bahan_txt)

    # Pustaka — baris isi berada persis di bawah label "Utama :" / "Pendukung :" (tc1).
    if any(k in draft for k in ("pustaka_utama", "pustakaUtama", "references_main")):
        source = draft.get("pustaka_utama", draft.get("pustakaUtama", draft.get("references_main")))
        set_tc_text(_rows_after(tbl0, "Utama :", 1, tc_idx=1, contains=True)[0], 1, _lines(source))
    if any(k in draft for k in ("pustaka_pendukung", "pustakaPendukung", "references_support")):
        source = draft.get("pustaka_pendukung", draft.get("pustakaPendukung", draft.get("references_support")))
        set_tc_text(_rows_after(tbl0, "Pendukung :", 1, tc_idx=1, contains=True)[0], 1, _lines(source))

    # R29 Dosen Pengampu: tc 0 header, tc1 names span 11
    all_names = _join_all_names(lecturers)
    if all_names:
        set_tc_text(_row_by_label(tbl0, "Dosen Pengampu"), 1, all_names)

    # --------------------------------------------------------------
    # Weekly rows R35-R43 (9 variable rows representing 16 minggu)
    # lxml tc mapping (8 tc): 0:Pertemuan Ke gs1, 1:Sub-CPMK gs2, 2:Indikator gs1, 3:Kriteria gs1,
    # 4:Daring gs1, 5:Luring gs3, 6:Materi gs3, 7:Bobot gs1 — merged rows: 2 tc [1,12]
    # Fields: week, material, method, experience, assessment_criteria, weight, is_merged
    # --------------------------------------------------------------
    weekly_rows = _rows_after(tbl0, "(1)", len(weekly_plans))
    if len(weekly_rows) < len(weekly_plans):
        raise DocxAnchorError(
            f"template hanya punya {len(weekly_rows)} baris mingguan, butuh {len(weekly_plans)}"
        )
    for i, wp in enumerate(weekly_plans):
        tr = weekly_rows[i]
        week = str(wp.get("week","") or CANONICAL_WEEKLY[i]["week"])
        material = str(wp.get("material","") or wp.get("materi","") or "")
        method = str(wp.get("method","") or wp.get("luring","") or 'TM 1×(4×50")')
        experience = str(wp.get("experience","") or "")
        criteria = str(wp.get("assessment_criteria","") or wp.get("assessmentCriteria","") or wp.get("kriteria","") or "")
        weight = wp.get("weight", 0)
        is_merged = bool(wp.get("is_merged", wp.get("isMerged", False)))
        # Prefer verbatim 8-col fields when present (AI baru / editor baru); else derive without duplication
        def _verb(k: str):
            v = wp.get(k)
            return str(v).strip() if isinstance(v, str) and v.strip() else ""

        if is_merged:
            set_tc_text(tr, 0, week)
            label = _verb("sub_cpmk") or _verb("materi") or material or ("UJIAN MID SEMESTER" if i==4 else "UJIAN FINAL SEMESTER")
            label = label.upper() if "UJIAN" in label.upper() else label
            set_tc_text(tr, 1, label, bold=True)
        else:
            # Prefer verbatim 8-col; fallback derived per-column distinct
            sub_cpmk = _verb("sub_cpmk")
            if not sub_cpmk:
                sub_cpmk = material
                if material and "mampu" not in material.lower() and "mahasiswa" not in material.lower():
                    sub_cpmk = f"Mahasiswa mampu menjelaskan tentang {material}"
                if not sub_cpmk: sub_cpmk = "-"
            indikator = _verb("indikator")
            if not indikator:
                if material:
                    indikator = f"Ketepatan dalam menjelaskan {material} | Keaktifan dalam diskusi | Kepatuhan terhadap kontrak mata kuliah"
                else:
                    indikator = experience if experience and len(experience) > 8 else "Ketepatan dalam menjelaskan materi"
            kriteria = _verb("kriteria") or (criteria if criteria else "Rubrik penilaian presentasi kelompok (lampiran 1) | Rubrik partisipasi kelas (lampiran 2) | Absensi")
            daring = _verb("daring") or "Menyesuaikan perkembangan pandemic COVID-19"
            luring = _verb("luring")
            if not luring:
                luring = method
                if experience and experience not in method:
                    luring = f"{method} | {experience}"
                if "TM" not in luring:
                    luring = f"{luring} [TM 1x(4x50\u201d)]"
                if not luring.strip(): luring = 'TM 1×(4×50")'
            materi = _verb("materi") or material or "-"

            set_tc_text(tr, 0, week)
            set_tc_text(tr, 1, sub_cpmk)
            set_tc_text(tr, 2, indikator)
            set_tc_text(tr, 3, kriteria)
            set_tc_text(tr, 4, daring)
            set_tc_text(tr, 5, luring)
            set_tc_text(tr, 6, materi)
            set_tc_text(tr, 7, str(weight))

    # Kode MK pada sampul, mis. "( IW21ASK1541 )". Dicocokkan dengan pola kode
    # dalam tanda kurung, bukan daftar kode milik template.
    code_pattern = re.compile(r"^\(\s*[A-Z0-9]{6,}\s*\)$")
    if course_code:
        for p in doc.paragraphs:
            if code_pattern.match(_normalise_ws(p.text or "")):
                _set_para_text(p, f"( {course_code} )", size=11, bold=True)
                break

    # --------------------------------------------------------------
    # TBL1 — Rencana Tugas Mahasiswa (RTM)
    # Halaman lampiran ini punya kop + identitas MK sendiri. Kalau dibiarkan,
    # seluruh isinya (prodi, dosen, tugas mind map anatomi, daftar rujukan)
    # tetap milik template dan bertentangan dengan halaman RPS di depannya.
    # Identitas disinkronkan; isi tugas hanya ditulis bila dipasok, sisanya
    # dikosongkan supaya tidak ada penugasan prodi lain yang tertinggal.
    # --------------------------------------------------------------
    tbl1 = doc.tables[1]
    assignment = draft.get("assignment") or draft.get("rencana_tugas") or {}
    if not isinstance(assignment, dict):
        assignment = {}

    def _assign(*keys) -> str:
        for k in keys:
            v = assignment.get(k)
            if isinstance(v, (str, int, float)) and str(v).strip():
                return str(v).strip()
            if isinstance(v, list):
                joined = "\n".join(str(x).strip() for x in v if str(x).strip())
                if joined:
                    return joined
        return ""

    set_tc_text(_row_by_label(tbl1, "Universitas Megarezky", tc_idx=1, contains=True), 1, kop_lines)
    set_tc_text(_row_by_label(tbl1, "MATA KULIAH"), 1, str(course_name))

    tr_kode = _row_by_label(tbl1, "KODE")
    set_tc_text(tr_kode, 1, str(course_code))
    set_tc_text(tr_kode, 3, str(sks_total))
    set_tc_text(tr_kode, 5, str(semester))
    set_tc_text(_row_by_label(tbl1, "DOSEN PENGAMPU"), 1, all_names)

    # Baris isi RTM: label di baris atas, isi di baris berikutnya (1 tc).
    rtm_fields = (
        ("BENTUK TUGAS", 0, _assign("bentuk", "bentuk_tugas", "form")),
        ("BENTUK TUGAS", 1, _assign("waktu", "waktu_pengerjaan", "duration")),
        ("JUDUL TUGAS", 0, _assign("judul", "title")),
        ("SUB CAPAIAN PEMBELAJARAN MATA KULIAH", 0, _assign("sub_cpmk", "subCpmk")),
        ("DISKRIPSI TUGAS", 0, _assign("deskripsi", "description")),
        ("METODE PENGERJAAN TUGAS", 0, _assign("metode", "method")),
        ("BENTUK DAN FORMAT LUARAN", 0, _assign("luaran", "output", "format")),
        ("INDIKATOR, KRITERIA DAN BOBOT PENILAIAN", 0, _assign("penilaian", "indikator", "assessment")),
        ("JADWAL PELAKSANAAN", 0, _assign("jadwal", "schedule") or "Sesuai jadwal perkuliahan"),
        ("LAIN-LAIN", 0, _assign("lain_lain", "notes")),
        ("DAFTAR RUJUKAN", 0, _assign("rujukan", "references") or _lines(
            draft.get("pustaka_utama", draft.get("pustakaUtama", [])))),
    )
    for label, tc_idx, value in rtm_fields:
        if label == "BENTUK TUGAS":
            # Baris "Mind Map | 4x50'" berisi dua kolom sekaligus.
            target = _rows_after(tbl1, label, 1)[0]
        else:
            target = _rows_after(tbl1, label, 1)[0]
        set_tc_text(target, tc_idx, value)

    # --------------------------------------------------------------
    # TBL3 — rubrik penilaian. Aspeknya klinis/pengukuran (asuhan pasien),
    # tidak berlaku lintas prodi. Ganti dengan rubrik yang dipasok; bila tidak
    # ada, pakai rubrik generik agar tidak menyesatkan.
    # --------------------------------------------------------------
    rubric = _as_list(draft.get("rubric") or draft.get("rubrik"))
    if not rubric:
        rubric = [
            {"aspect": "Ketepatan pemahaman konsep dan ruang lingkup tugas", "weight": 15},
            {"aspect": "Ketepatan penerapan metode/prosedur penyelesaian", "weight": 25},
            {"aspect": "Kedalaman analisis dan argumentasi", "weight": 25},
            {"aspect": "Kualitas dan kelengkapan luaran", "weight": 20},
            {"aspect": "Kerapian penyajian serta ketepatan waktu pengumpulan", "weight": 15},
        ]
    try:
        tbl3 = doc.tables[3]
        total_row_idx = _row_index_by_label(tbl3, "NILAI TOTAL")
        body_rows = [tbl3.rows[i]._tr for i in range(1, total_row_idx)]
        total_weight = 0
        for idx, tr in enumerate(body_rows):
            if idx < len(rubric):
                entry = rubric[idx] if isinstance(rubric[idx], dict) else {"aspect": str(rubric[idx])}
                aspect = str(entry.get("aspect") or entry.get("aspek") or "").strip()
                weight = entry.get("weight", entry.get("bobot", 0))
                set_tc_text(tr, 0, str(idx + 1))
                set_tc_text(tr, 1, aspect)
                set_tc_text(tr, 2, str(weight))
                set_tc_text(tr, 3, "")
                try:
                    total_weight += int(float(weight))
                except (TypeError, ValueError):
                    pass
            else:
                for ci in range(4):
                    set_tc_text(tr, ci, "")
        set_tc_text(tbl3.rows[total_row_idx]._tr, 1, str(total_weight or 100))
    except DocxAnchorError as exc:
        print(f"[docx] rubrik tbl3 gagal: {exc}")
        raise

    # Enforce docDefaults fonts already Times; but ensure sections unchanged
    # No page size/orientation mutation – template preserves 6 sectPr exactly

    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    filename = f"{course_code}-{course_name}-RPS.docx".replace(" ", "_")
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
