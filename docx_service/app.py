from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from docx import Document
from docx.shared import Pt, Emu
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from io import BytesIO
import json
import pathlib
import re

app = FastAPI(title="RPS DOCX Service")

TEMPLATE_PATH = pathlib.Path(__file__).parent / "template.docx"

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
        except: return SZ
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
                except: pass
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


def _norm_lecturers(raw):
    # raw can be list or JSON string
    if isinstance(raw, str):
        try: raw = json.loads(raw)
        except: raw = []
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
    except: return s

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

    course_code = draft.get("course_code") or draft.get("courseCode") or "IW21ASK1541"
    course_name = draft.get("course_name") or draft.get("courseName") or "Ilmu Biomedik Dasar"
    sks_total = draft.get("sks_total") or draft.get("sksTotal") or 4
    sks_theory = draft.get("sks_theory") or draft.get("sksTheory") or 3
    sks_practice = draft.get("sks_practice") or draft.get("sksPractice") or 1
    semester = draft.get("semester") or "I"
    preparation_date = draft.get("preparation_date") or draft.get("preparationDate") or "2025-06-28"
    lecturers_raw = draft.get("lecturers") or []
    if isinstance(lecturers_raw, str):
        try: lecturers_raw = json.loads(lecturers_raw)
        except: lecturers_raw = []
    weekly_raw = draft.get("weekly_plans") or draft.get("weeklyPlans") or []
    if isinstance(weekly_raw, str):
        try: weekly_raw = json.loads(weekly_raw)
        except: weekly_raw = []
    cpl = draft.get("cpl") or []
    cpmk = draft.get("cpmk") or []
    sub_cpmk = draft.get("sub_cpmk") or draft.get("subCpmk") or []
    for arr in (cpl, cpmk, sub_cpmk):
        if isinstance(arr, str):
            try: arr_vars = json.loads(arr)  # noqa
            except: pass
    # Type: after possible string parse above, ensure correct var
    if isinstance(cpl, str):
        try: cpl = json.loads(cpl)
        except: cpl = []
    if isinstance(cpmk, str):
        try: cpmk = json.loads(cpmk)
        except: cpmk = []
    if isinstance(sub_cpmk, str):
        try: sub_cpmk = json.loads(sub_cpmk)
        except: sub_cpmk = []

    lecturers = _ensure_lecturers(_norm_lecturers(lecturers_raw))
    weekly_plans = _normalize_weekly(weekly_raw if isinstance(weekly_raw, list) else [])

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
    # TBL0 -- 44x13 main
    # Indices via inspection: see earlier dump
    # We replace content in place, preserving gridSpan/vMerge/shd
    # --------------------------------------------------------------
    tbl0 = doc.tables[0]  # 44 rows
    # R03 row 3: course identity — use lxml tc indices (7 tc: 0 name gs3,1 code gs2,2 cluster gs2,3 T,4 P,5 semester,6 date gs3)
    try:
        tr03 = tbl0.rows[3]._tr
        rumpun = draft.get("course_cluster") or draft.get("courseCluster") or "Keperawatan"
        set_tc_text(tr03, 0, str(course_name))
        set_tc_text(tr03, 1, str(course_code))
        set_tc_text(tr03, 2, str(rumpun))
        set_tc_text(tr03, 3, f"T={sks_theory}")
        set_tc_text(tr03, 4, f"P={sks_practice}")
        set_tc_text(tr03, 5, str(semester))
        set_tc_text(tr03, 6, _format_date(preparation_date))
    except Exception: pass

    # R05 row 5: Otorisasi names — 4 tc [3,2,4,4]: tc1 pengembang, tc2 koordinator, tc3 ketua_prodi
    try:
        tr05 = tbl0.rows[5]._tr
        by_role = _split_by_role(lecturers)
        # keep empty tc0 as is
        if by_role.get("pengembang"):
            set_tc_text(tr05, 1, by_role["pengembang"])
        if by_role.get("koordinator_mk"):
            set_tc_text(tr05, 2, by_role["koordinator_mk"])
        if by_role.get("ketua_prodi"):
            set_tc_text(tr05, 3, by_role["ketua_prodi"])
    except Exception: pass

    # ---- CP section ----
    # Keep typo "paian Pembelajaran (CP)" as original (header row 6)
    # R07-08 CPL, R10-13 CPMK, R15-21 Sub-CPMK — each has 3 tc [2,1,10] (vMerge header, code, desc)
    try:
        for idx, cpl_item in enumerate(cpl[:2]):
            tr = tbl0.rows[7+idx]._tr
            code = cpl_item.get("code") or f"CPL{idx+1}"
            desc = cpl_item.get("description") or cpl_item.get("desc") or ""
            set_tc_text(tr, 1, str(code))
            set_tc_text(tr, 2, str(desc))
    except Exception: pass
    try:
        for idx, pmk in enumerate(cpmk[:4]):
            tr = tbl0.rows[10+idx]._tr
            code = pmk.get("code") or f"CPMK {idx+1}"
            desc = pmk.get("description") or pmk.get("desc") or ""
            set_tc_text(tr, 1, str(code))
            set_tc_text(tr, 2, str(desc))
    except Exception: pass
    try:
        for idx, sc in enumerate(sub_cpmk[:7]):
            tr = tbl0.rows[15+idx]._tr
            code = sc.get("code") or f"Sub-CPMK-{idx+1}"
            desc = sc.get("description") or sc.get("desc") or ""
            set_tc_text(tr, 1, str(code))
            set_tc_text(tr, 2, str(desc))
    except Exception: pass

    # R23 deskripsi singkat (tc 0 header "Deskripsi Singkat MK", tc1 desc span 11), R24 bahan kajian similar
    try:
        desc = draft.get("description") or draft.get("deskripsi") or draft.get("short_description") or ""
        if desc:
            set_tc_text(tbl0.rows[23]._tr, 1, str(desc))
    except Exception: pass
    try:
        bahan = draft.get("bahan_kajian") or draft.get("bahanKajian") or []
        if isinstance(bahan, str):
            try: bahan = json.loads(bahan)
            except: bahan = [bahan]
        if isinstance(bahan, list) and bahan:
            txt = "\n".join(str(x) for x in bahan if str(x).strip())
            set_tc_text(tbl0.rows[24]._tr, 1, txt)
    except Exception: pass

    # R25-28 Pustaka — R25 header [2,11] "Pustaka Utama", R26 content [2,11], R27 header "Pendukung", R28 content
    try:
        pustaka_utama = draft.get("pustaka_utama") or draft.get("pustakaUtama") or draft.get("references_main") or []
        pustaka_pend = draft.get("pustaka_pendukung") or draft.get("pustakaPendukung") or draft.get("references_support") or []
        def _to_lines(arr):
            if isinstance(arr, str):
                try: arr=json.loads(arr)
                except: return str(arr)
            if not isinstance(arr, list): return str(arr)
            return "\n".join(str(x) for x in arr if str(x).strip())
        if pustaka_utama:
            set_tc_text(tbl0.rows[26]._tr, 1, _to_lines(pustaka_utama))
        if pustaka_pend:
            if len(tbl0.rows) > 28:
                set_tc_text(tbl0.rows[28]._tr, 1, _to_lines(pustaka_pend))
    except Exception: pass

    # R29 Dosen Pengampu: tc 0 header, tc1 names span 11
    try:
        all_names = _join_all_names(lecturers)
        if all_names:
            set_tc_text(tbl0.rows[29]._tr, 1, all_names)
    except Exception: pass

    # R31 empty spacer – skip
    # R32-34 header weekly – keep static shading/borders

    # --------------------------------------------------------------
    # Weekly rows R35-R43 (9 variable rows representing 16 minggu)
    # lxml tc mapping (8 tc): 0:Pertemuan Ke gs1, 1:Sub-CPMK gs2, 2:Indikator gs1, 3:Kriteria gs1,
    # 4:Daring gs1, 5:Luring gs3, 6:Materi gs3, 7:Bobot gs1 — merged rows: 2 tc [1,12]
    # Fields: week, material, method, experience, assessment_criteria, weight, is_merged
    # --------------------------------------------------------------
    WEEKLY_ROW_IDX = [35,36,37,38,39,40,41,42,43]
    for i, wp in enumerate(weekly_plans):
        try:
            ridx = WEEKLY_ROW_IDX[i]
            tr = tbl0.rows[ridx]._tr
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
        except Exception:
            continue

    # --------------------------------------------------------------
    # Cover code "( IW25ASK105431 )" at p idx 3  – FIX to canonical IW21ASK1541
    # Scan body paragraphs before first tbl for that code pattern
    # --------------------------------------------------------------
    try:
        for p in doc.paragraphs:
            txt = p.text or ""
            if "IW25ASK105431" in txt or "IWSN321312" in txt or "17505R0203" in txt:
                # Replace in-place runs
                raw = p.text
                # direct replacement preserving runs: simpler call clear+add
                # capture original run size? Use set via clearing
                for r in list(p.runs):
                    r._r.getparent().remove(r._r)
                run = p.add_run(raw.replace("IW25ASK105431", course_code).replace("IWSN321312", course_code).replace("17505R0203", course_code))
                run.font.size = Pt(11)
                run.font.name = FONT
                run.bold = True
                break
        # Specific cover p at index 3: "( IW21ASK1541 )"
        # Use manual: find p text containing parentheses code and enforce
        for p in doc.paragraphs[:15]:
            if p.text and "(" in p.text and ")" in p.text and any(c.isdigit() for c in p.text):
                if any(x in p.text for x in ["IW","R0203","IWSN","ASK"]):
                    for r in list(p.runs):
                        r._r.getparent().remove(r._r)
                    run = p.add_run(f"( {course_code} )")
                    run.font.size = Pt(11); run.font.name = FONT; run.bold = True
                    break
    except Exception:
        pass

    # Also fix RTM table kode (tbl1 R03 kode 17505R0203 -> same canonical)
    try:
        tbl1 = doc.tables[1]
        # R03 idx 3
        if len(tbl1.rows) > 3:
            # cells pattern gs 1,2,1,1,1,1 -> col1 is code value
            if len(tbl1.rows[3].cells) >= 2:
                set_cell_text(tbl1.rows[3].cells[1], str(course_code))
    except Exception: pass

    # Enforce docDefaults fonts already Times; but ensure sections unchanged
    # No page size/orientation mutation – template preserves 6 sectPr exactly

    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    filename = f"{course_code}-{course_name}-RPS.docx".replace(" ", "_")
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
