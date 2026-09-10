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
    faculty = draft.get("faculty") or draft.get("faculty_label") or "Fakultas Keperawatan dan Kebidanan"
    study_program = draft.get("study_program") or draft.get("studyProgram") or draft.get("prodi") or "S1 Ilmu Keperawatan"
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
    try:
        for p in doc.paragraphs:
            txt = (p.text or "").strip()
            norm = _normalise_ws(txt)
            txt_up = norm.upper()
            # Cover & sampul body: both variants (P20 dash, P25 DAN double-space)
            if txt_up.startswith("PROGRAM STUDI") and "KEPERAWATAN" in txt_up:
                # Either cover variant — replace with actual prodi
                disp = _prodi_display(str(study_program or "")) or _normalise_ws(txt).upper()
                _set_para_text(p, disp, size=11, bold=True)
            elif txt_up.startswith("FAKULTAS") and "KEPERAWATAN" in txt_up:
                fac_cover = str(faculty or "").strip().upper() or txt_up
                if not (fac_cover.startswith("FAKULTAS") or fac_cover.startswith("PROGRAM PASCASARJANA")):
                    fac_cover = f"FAKULTAS {fac_cover}"
                _set_para_text(p, fac_cover, size=11, bold=True)
            elif txt.startswith("MATA KULIAH"):
                mata = str(course_name or "").strip().upper() or "ILMU BIOMEDIK DASAR"
                new_mata = f"MATA KULIAH \u2013 {mata}"
                _set_para_text(p, new_mata, size=11, bold=True)
    except Exception: pass
    # --- Narasi sampul: Visi / Misi / Profil Lulusan / CPL-PRODI luar tabel (P31–P60) ---
    # Overwrite dengan payload program jika tersedia; else fallback biarkan template (tapi sudah fak fix di atas)
    try:
        prog_vision = draft.get("program_vision") or draft.get("programVision")
        prog_mission = draft.get("program_mission") or draft.get("programMission") or []
        prog_profile = draft.get("program_graduate_profile") or draft.get("programGraduateProfile") or []
        prog_cpl = draft.get("program_cpl") or draft.get("programCpl") or []
        if isinstance(prog_mission, str):
            try: prog_mission = json.loads(prog_mission)
            except: prog_mission = [prog_mission]
        if isinstance(prog_profile, str):
            try: prog_profile = json.loads(prog_profile)
            except: prog_profile = [prog_profile]
        if isinstance(prog_cpl, str):
            try: prog_cpl = json.loads(prog_cpl)
            except: prog_cpl = []
        # Locate anchor paragraphs by exact flag
        paras = doc.paragraphs
        def _find_flag(flag: str):
            for idx, pp in enumerate(paras):
                if (pp.text or "").strip() == flag:
                    return idx
            return -1
        # Visi: single paragraph after header "Visi" (P31->P33)
        if prog_vision and isinstance(prog_vision, str) and prog_vision.strip():
            visi_idx = _find_flag("Visi")
            if visi_idx != -1:
                # Expect P+2 is visi body; but scan forward up to 4 for non-empty non-header
                for j in range(visi_idx + 1, min(len(paras), visi_idx + 6)):
                    t = (paras[j].text or "").strip()
                    if not t: continue
                    if t in ("Misi", "Profil Lulusan", "Capaian Pembelajaran Lulusan"):
                        break
                    # first real body paragraph after Visi header
                    _set_para_text(paras[j], prog_vision.strip(), size=10, bold=False)
                    break
        # Misi: replace up to len(prog_mission) paragraphs after "Misi" header; clear extras or shrink
        if prog_mission and isinstance(prog_mission, list) and prog_mission:
            misi_idx = _find_flag("Misi")
            if misi_idx != -1:
                # Collect indices of consecutive non-empty non-header paragraphs until next flag
                body_idxs = []
                for j in range(misi_idx + 1, len(paras)):
                    t = (paras[j].text or "").strip()
                    if not t: continue
                    if t in ("Profil Lulusan", "Capaian Pembelajaran Lulusan", "Visi"):
                        break
                    # header sentinel empty after misi block
                    if len(body_idxs) >= 12:
                        break
                    body_idxs.append(j)
                    if len(body_idxs) >= len(prog_mission) + 3:  # allow slack
                        pass
                # we have up to N misi items; map first N body_idxs
                clean_misi = [str(x).strip() for x in prog_mission if str(x).strip()]
                for k, idx in enumerate(body_idxs):
                    if k < len(clean_misi):
                        _set_para_text(paras[idx], clean_misi[k], size=10, bold=False)
                    else:
                        # clear surplus template misi lines (extra keperawatan)
                        _set_para_text(paras[idx], "", size=10, bold=False)
                # If template had fewer paras than misi, append new paras after last body index (before next section)
                if len(clean_misi) > len(body_idxs):
                    insert_after = body_idxs[-1] if body_idxs else misi_idx
                    # Insert new p elements via oxml: create p after insert_after
                    for extra in clean_misi[len(body_idxs):]:
                        new_p = OxmlElement('w:p')
                        # copy pPr? minimal justify
                        pPr = OxmlElement('w:pPr')
                        jc = OxmlElement('w:jc'); jc.set(qn('w:val'), 'both')
                        pPr.append(jc)
                        new_p.append(pPr)
                        r_el = OxmlElement('w:r')
                        rPr = OxmlElement('w:rPr')
                        _set_sz(rPr, 20)  # 10pt
                        _ensure_fonts(rPr, FONT)
                        r_el.append(rPr)
                        t_el = OxmlElement('w:t'); t_el.text = extra; r_el.append(t_el)
                        new_p.append(r_el)
                        paras[insert_after]._p.addnext(new_p)
                        # shift: re-collect paras reference in next loop not needed; doc.paragraphs rebuilds lazily
        # Profil Lulusan: header "Profil Lulusan" then 1 title + 5 entries
        if prog_profile and isinstance(prog_profile, list) and prog_profile:
            prof_idx = _find_flag("Profil Lulusan")
            if prof_idx != -1:
                # Collect body indices until CPL header
                body2 = []
                for j in range(prof_idx + 1, len(paras)):
                    t = (paras[j].text or "").strip()
                    if not t: continue
                    if t in ("Capaian Pembelajaran Lulusan", "Analisis Pembelajaran"):
                        break
                    body2.append(j)
                # Expected template: 1 title "Profil lulusan Program Studi ..." + 5 items
                # Build replacement block: first line is generic title for this prodi
                clean_prof = [str(x).strip() for x in prog_profile if str(x).strip()]
                # If clean_prof is a single long string with sentences, split by ". " only for display if needed - but keep as-is for first pass
                # Title line
                prodi_label = str(study_program or "Program Studi").strip()
                title_line = f"Profil lulusan {prodi_label}:"
                replacement = [title_line] + clean_prof if clean_prof else []
                # If replacement length < body2, clear surplus; if longer, append
                for k, idx in enumerate(body2):
                    if k < len(replacement):
                        _set_para_text(paras[idx], replacement[k], size=10, bold=False)
                    else:
                        _set_para_text(paras[idx], "", size=10, bold=False)
                if len(replacement) > len(body2):
                    insert_after = body2[-1] if body2 else prof_idx
                    for extra in replacement[len(body2):]:
                        new_p = OxmlElement('w:p')
                        pPr = OxmlElement('w:pPr')
                        jc = OxmlElement('w:jc'); jc.set(qn('w:val'), 'both')
                        pPr.append(jc)
                        new_p.append(pPr)
                        r_el = OxmlElement('w:r'); rPr = OxmlElement('w:rPr')
                        _set_sz(rPr, 20); _ensure_fonts(rPr, FONT); r_el.append(rPr)
                        t_el = OxmlElement('w:t'); t_el.text = extra; r_el.append(t_el)
                        new_p.append(r_el)
                        paras[insert_after]._p.addnext(new_p)
        # CPL-PRODI narasi (P55 headers): replace items under "Capaian Pembelajaran Lulusan"
        if prog_cpl and isinstance(prog_cpl, list) and prog_cpl:
            cpl_idx = _find_flag("Capaian Pembelajaran Lulusan")
            if cpl_idx != -1:
                body3 = []
                for j in range(cpl_idx + 1, len(paras)):
                    t = (paras[j].text or "").strip()
                    if not t: continue
                    if t in ("Analisis Pembelajaran", "Visi", "Misi"):
                        break
                    # filter out notes later (Catatan :) but include CPL bodies
                    if t.startswith("Catatan"):
                        break
                    body3.append(j)
                    if len(body3) >= 6: break
                clean_cpl = []
                for item in prog_cpl:
                    if isinstance(item, dict):
                        clean_cpl.append(str(item.get("description") or item.get("desc") or "").strip())
                    else:
                        clean_cpl.append(str(item).strip())
                clean_cpl = [x for x in clean_cpl if x]
                for k, idx in enumerate(body3):
                    if k < len(clean_cpl):
                        _set_para_text(paras[idx], clean_cpl[k], size=10, bold=False)
                    else:
                        _set_para_text(paras[idx], "", size=10, bold=False)
                if len(clean_cpl) > len(body3):
                    insert_after = body3[-1] if body3 else cpl_idx
                    for extra in clean_cpl[len(body3):]:
                        new_p = OxmlElement('w:p')
                        pPr = OxmlElement('w:pPr')
                        jc = OxmlElement('w:jc'); jc.set(qn('w:val'), 'both')
                        pPr.append(jc); new_p.append(pPr)
                        r_el = OxmlElement('w:r'); rPr = OxmlElement('w:rPr')
                        _set_sz(rPr, 20); _ensure_fonts(rPr, FONT); r_el.append(rPr)
                        t_el = OxmlElement('w:t'); t_el.text = extra; r_el.append(t_el)
                        new_p.append(r_el)
                        paras[insert_after]._p.addnext(new_p)
    except Exception as _e:
        # don't fail overall doc on narasi overwrite
        import traceback as _tb
        try:
            print(f"[docx] narasi overwrite failed: {_e} {_tb.format_exc()[:600]}")
        except: pass

    # --------------------------------------------------------------
    # TBL0 -- 44x13 main
    # Indices via inspection: see earlier dump
    # We replace content in place, preserving gridSpan/vMerge/shd
    # --------------------------------------------------------------
    tbl0 = doc.tables[0]  # 44 rows

    # Kop R00 table header Fakultas+Prodi — update dari faculty/study_program (preserve image cell)
    # tbl0 R00 has 3 tc (gs 2,9,2): tc1 holds the kop block. Use lxml to avoid python-docx duplicate gridSpan expansion.
    try:
        tr00 = tbl0.rows[0]._tr
        tcs00 = tr00.findall(qn('w:tc'))
        if len(tcs00) >= 2:
            fakultas_line = str(faculty or "").strip() or "Fakultas Keperawatan dan Kebidanan"
            if not (fakultas_line.startswith("Fakultas") or fakultas_line.startswith("Program Pascasarjana")):
                fakultas_line = f"Fakultas {fakultas_line}"
            prodi_raw = str(study_program or "").strip() or "Program Studi S1 Ilmu Keperawatan"
            # normalize prodi display: if already has prefix (Program Studi/Profesi/S1/S2/D3/D4/Magister) keep, else keep raw
            if prodi_raw.startswith("Program Studi") or prodi_raw.startswith("Profesi") or prodi_raw.startswith("Magister") or prodi_raw.startswith("S1") or prodi_raw.startswith("S2") or prodi_raw.startswith("D3") or prodi_raw.startswith("D4"):
                prodi_line = prodi_raw
            else:
                prodi_line = prodi_raw
            # ensure Program Studi prefix for display when prodi is S1/S2/D3/D4 without prefix
            display_prodi = prodi_line
            if display_prodi.startswith("S1 ") or display_prodi.startswith("S2 ") or display_prodi.startswith("D3 ") or display_prodi.startswith("D4 "):
                if not display_prodi.startswith("Program Studi"):
                    display_prodi = f"Program Studi {display_prodi}"
            new_kop = f"Universitas Megarezky\n{fakultas_line}\n{display_prodi}"
            set_tc_text(tr00, 1, new_kop)
    except Exception:
        pass
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

    # R05 row 5: Otorisasi names — 4 tc [3,2,4,4]: tc1 pengembang, tc2 koordinator, tc3 ketua_prodi — clear stale Keperawatan when role missing
    try:
        tr05 = tbl0.rows[5]._tr
        by_role = _split_by_role(lecturers)
        koord_name = by_role.get("koordinator_mk") or ""
        ketua_name = by_role.get("ketua_prodi") or ""
        # Pengembang: only explicit role 'pengembang'; anggota => blank (hindari isi anggota ke kolom Pengembang)
        pengembang_name = by_role.get("pengembang") or ""
        print(f"[docx] R05 lecturers={lecturers} by_role={by_role} peng='{pengembang_name}' koord='{koord_name}' ketua='{ketua_name}'")
        r1 = set_tc_text(tr05, 1, pengembang_name)
        r2 = set_tc_text(tr05, 2, koord_name)
        r3 = set_tc_text(tr05, 3, ketua_name)
        print(f"[docx] R05 set results r1={r1} r2={r2} r3={r3}")
        # debug dump after
        try:
            from docx.oxml.ns import qn as _qn
            tcs_dbg = tr05.findall(_qn('w:tc'))
            for _i,_tc in enumerate(tcs_dbg):
                _ps=_tc.findall(_qn('w:p'))
                _txt="".join("".join(_t.text or "" for _t in _p.findall(_qn('w:t'))) for _p in _ps)
                print(f"[docx] R05 after tc{_i}='{ _txt[:80]}' ps={len(_ps)}")
        except Exception as _e: print(f"[docx] R05 dbg fail {_e}")
    except Exception as e:
        import traceback as _tb
        print(f"[docx] R05 failed {e} {_tb.format_exc()[:500]}")
    # Tim Pengajar line outside tables (P07 label + P08 name) — patch stale Ns. Sri... to actual lecturers
    try:
        tim_idx = -1
        for idx, pp in enumerate(doc.paragraphs):
            if (pp.text or "").strip().startswith("Tim Pengajar"):
                tim_idx = idx
                break
        if tim_idx != -1 and tim_idx + 1 < len(doc.paragraphs):
            name_para = doc.paragraphs[tim_idx + 1]
            if lecturers:
                parts = []
                forlec = lecturers
                for l in forlec:
                    nm = (l.get("name") or "").strip()
                    if not nm: continue
                    role = l.get("role") or ""
                    suffix = ""
                    if role == "koordinator_mk": suffix = " – (Koordinator)"
                    elif role == "ketua_prodi": suffix = " – (Ketua Prodi)"
                    elif role == "pengembang": suffix = " – (Pengembang)"
                    parts.append(f"{nm}{suffix}")
                display = ", ".join(parts) if parts else ""
                if display:
                    _set_para_text(name_para, display, size=11, bold=False)
    except Exception: pass

    # ---- CP section ----
    # R07-08 CPL, R10-13 CPMK, R15-21 Sub-CPMK — each has 3 tc [2,1,10] (vMerge header, code, desc)
    # If payload provides cpl/cpmk/sub_cpmk (even empty), clear surplus rows so Keperawatan template tidak bocor
    has_cpl = any(k in draft for k in ("cpl",))
    has_cpmk = any(k in draft for k in ("cpmk",))
    has_sub = any(k in draft for k in ("sub_cpmk", "subCpmk"))
    try:
        for idx in range(2):
            tr = tbl0.rows[7+idx]._tr
            if idx < len(cpl):
                code = cpl[idx].get("code") or f"CPL{idx+1}"
                desc = cpl[idx].get("description") or cpl[idx].get("desc") or ""
                set_tc_text(tr, 1, str(code))
                set_tc_text(tr, 2, str(desc))
            elif has_cpl:
                set_tc_text(tr, 1, "")
                set_tc_text(tr, 2, "")
    except Exception: pass
    try:
        for idx in range(4):
            tr = tbl0.rows[10+idx]._tr
            if idx < len(cpmk):
                code = cpmk[idx].get("code") or f"CPMK {idx+1}"
                desc = cpmk[idx].get("description") or cpmk[idx].get("desc") or ""
                set_tc_text(tr, 1, str(code))
                set_tc_text(tr, 2, str(desc))
            elif has_cpmk:
                set_tc_text(tr, 1, "")
                set_tc_text(tr, 2, "")
    except Exception: pass
    try:
        for idx in range(7):
            tr = tbl0.rows[15+idx]._tr
            if idx < len(sub_cpmk):
                code = sub_cpmk[idx].get("code") or f"Sub-CPMK-{idx+1}"
                desc = sub_cpmk[idx].get("description") or sub_cpmk[idx].get("desc") or ""
                set_tc_text(tr, 1, str(code))
                set_tc_text(tr, 2, str(desc))
            elif has_sub:
                set_tc_text(tr, 1, "")
                set_tc_text(tr, 2, "")
    except Exception: pass

    # R23 deskripsi singkat (tc 0 header "Deskripsi Singkat MK", tc1 desc span 11), R24 bahan kajian similar
    # If payload explicitly provides description/bahan (even empty), overwrite template — jangan biarkan Keperawatan bocor ke prodi lain
    try:
        desc_has = any(k in draft for k in ("description", "deskripsi", "short_description"))
        desc = draft.get("description") if "description" in draft else (draft.get("deskripsi") if "deskripsi" in draft else draft.get("short_description") if "short_description" in draft else "")
        if desc_has or desc:
            set_tc_text(tbl0.rows[23]._tr, 1, str(desc or "").strip())
    except Exception: pass
    try:
        bahan_has = any(k in draft for k in ("bahan_kajian", "bahanKajian"))
        bahan = draft.get("bahan_kajian") if "bahan_kajian" in draft else draft.get("bahanKajian") if "bahanKajian" in draft else []
        if isinstance(bahan, str):
            try: bahan = json.loads(bahan)
            except: bahan = [bahan]
        if bahan_has:
            if isinstance(bahan, list) and bahan:
                txt = "\n".join(str(x) for x in bahan if str(x).strip())
                set_tc_text(tbl0.rows[24]._tr, 1, txt)
            else:
                set_tc_text(tbl0.rows[24]._tr, 1, "")
    except Exception: pass

    # R25-28 Pustaka — R25 header [2,11] "Pustaka Utama", R26 content [2,11], R27 header "Pendukung", R28 content
    try:
        pu_has = any(k in draft for k in ("pustaka_utama", "pustakaUtama", "references_main"))
        pp_has = any(k in draft for k in ("pustaka_pendukung", "pustakaPendukung", "references_support"))
        pustaka_utama = draft.get("pustaka_utama") if "pustaka_utama" in draft else draft.get("pustakaUtama") if "pustakaUtama" in draft else draft.get("references_main") if "references_main" in draft else []
        pustaka_pend = draft.get("pustaka_pendukung") if "pustaka_pendukung" in draft else draft.get("pustakaPendukung") if "pustakaPendukung" in draft else draft.get("references_support") if "references_support" in draft else []
        def _to_lines(arr):
            if isinstance(arr, str):
                try: arr=json.loads(arr)
                except: return str(arr)
            if not isinstance(arr, list): return str(arr)
            return "\n".join(str(x) for x in arr if str(x).strip())
        if pu_has:
            if isinstance(pustaka_utama, list) and pustaka_utama and any(str(x).strip() for x in pustaka_utama):
                set_tc_text(tbl0.rows[26]._tr, 1, _to_lines(pustaka_utama))
            elif isinstance(pustaka_utama, str) and pustaka_utama.strip():
                set_tc_text(tbl0.rows[26]._tr, 1, pustaka_utama)
            else:
                set_tc_text(tbl0.rows[26]._tr, 1, "")
        if len(tbl0.rows) > 28 and pp_has:
            if isinstance(pustaka_pend, list) and pustaka_pend and any(str(x).strip() for x in pustaka_pend):
                set_tc_text(tbl0.rows[28]._tr, 1, _to_lines(pustaka_pend))
            elif isinstance(pustaka_pend, str) and str(pustaka_pend).strip():
                set_tc_text(tbl0.rows[28]._tr, 1, str(pustaka_pend))
            else:
                set_tc_text(tbl0.rows[28]._tr, 1, "")
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
