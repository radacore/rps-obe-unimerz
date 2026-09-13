"""Regression tests for the RPS generator.

The template is a real Keperawatan document. Every value that is not overwritten
stays in the output, so the tests assert on absence of that source content as
much as on presence of the payload.

    python3 -m pytest docx_service/test_generate.py
"""

import re
from io import BytesIO

import pytest
from docx import Document
from docx.oxml.ns import qn
from fastapi.testclient import TestClient

import docx_service.app as app_module
from docx_service.app import app, split_profile_items

client = TestClient(app)

# Wording that only exists in the Keperawatan/Kebidanan template. Matched on word
# boundaries: substring matching flags legitimate words ("ners" in "partners").
TEMPLATE_ONLY_TERMS = (
    "keperawatan", "kebidanan", "biomedik", "ners", "asuhan", "pasien",
    "perawat", "anatomi", "fisiologi", "sri wahyuni", "iqwan", "bobak",
    "mind map", "maternitas", "IW21ASK1541", "17505R0203",
)
LEAK_RE = re.compile(r"\b(" + "|".join(re.escape(t) for t in TEMPLATE_ONLY_TERMS) + r")\b", re.I)

PAYLOAD = {
    "rps_draft": {
        "course_name": "Algoritma dan Struktur Data",
        "course_code": "IK24IK1201",
        "course_cluster": "Ilmu Komputer",
        "faculty": "Fakultas Ilmu Komputer",
        "study_program": "S1 Ilmu Komputer",
        "sks_total": 3,
        "sks_theory": 2,
        "sks_practice": 1,
        "semester": "III",
        "preparation_date": "2026-03-15",
        "lecturers": [
            {"name": "Dr. Andi Pratama, S.Kom., M.Kom.", "role": "koordinator_mk"},
            {"name": "Dian Utami, S.Kom., M.T.", "role": "anggota"},
        ],
        "description": "Mata kuliah ini membahas konsep algoritma dan struktur data.",
        "bahan_kajian": ["Konsep Algoritma", "Abstract Data Type"],
        "pustaka_utama": ["Cormen, T. H. (2022). Introduction to Algorithms."],
        "pustaka_pendukung": ["Weiss, M. A. (2014). Data Structures."],
        "cpl": [{"code": "CPL1", "description": "Beretika informatika."}],
        "cpmk": [{"code": "CPMK 1", "description": "Menganalisis kompleksitas."}],
        "sub_cpmk": [{"code": "Sub-CPMK-1", "description": "Menjelaskan ADT."}],
        "weekly_plans": [],
        "program_vision": "Menjadi Program Studi Ilmu Komputer bermutu.",
        "program_mission": ["Menyelenggarakan pendidikan bermutu."],
        "program_graduate_profile": ["Systems Analyst", "Software Developer"],
        "program_cpl": [{"code": "CPL1", "description": "Beretika informatika."}],
    }
}


def generate(payload: dict) -> Document:
    response = client.post("/generate", json=payload)
    assert response.status_code == 200, response.text
    return Document(BytesIO(response.content))


def cell_text(tc) -> str:
    return "\n".join(
        "".join("".join(t.text or "" for t in r.findall(qn('w:t')))
                for r in p.findall(qn('w:r')))
        for p in tc.findall(qn('w:p'))
    ).strip()


def all_text_nodes(doc: Document):
    """Yield (location, text) for every paragraph and every table cell."""
    for idx, para in enumerate(doc.paragraphs):
        yield f"para[{idx}]", (para.text or "").strip()
    for t_idx, table in enumerate(doc.tables):
        for r_idx, row in enumerate(table.rows):
            for c_idx, tc in enumerate(row._tr.findall(qn('w:tc'))):
                yield f"tbl{t_idx}[R{r_idx}C{c_idx}]", cell_text(tc)


def row_by_label(table, label: str, tc_idx: int = 0):
    for row in table.rows:
        tcs = row._tr.findall(qn('w:tc'))
        if tc_idx < len(tcs) and label.lower() in cell_text(tcs[tc_idx]).lower():
            return row._tr
    raise AssertionError(f"row '{label}' not found")


def test_no_template_content_leaks_into_other_program():
    doc = generate(PAYLOAD)
    leaks = [(where, text) for where, text in all_text_nodes(doc) if LEAK_RE.search(text)]
    assert leaks == [], f"template content leaked: {leaks}"


def test_cover_and_kop_follow_payload():
    doc = generate(PAYLOAD)
    texts = [(p.text or "").strip() for p in doc.paragraphs]
    assert "PROGRAM STUDI S1 ILMU KOMPUTER" in texts
    assert "FAKULTAS ILMU KOMPUTER" in texts
    assert "MATA KULIAH – ALGORITMA DAN STRUKTUR DATA" in texts
    kop = cell_text(row_by_label(doc.tables[0], "Kode Dokumen", tc_idx=2).findall(qn('w:tc'))[1])
    assert "Fakultas Ilmu Komputer" in kop
    assert "Program Studi S1 Ilmu Komputer" in kop


def test_rtm_appendix_matches_main_table():
    """The RTM page carries its own identity block; it must not contradict the RPS."""
    doc = generate(PAYLOAD)
    rtm = doc.tables[1]
    assert cell_text(row_by_label(rtm, "MATA KULIAH").findall(qn('w:tc'))[1]) == "Algoritma dan Struktur Data"
    kode_row = row_by_label(rtm, "KODE").findall(qn('w:tc'))
    assert cell_text(kode_row[1]) == "IK24IK1201"
    assert cell_text(kode_row[3]) == "3"
    assert cell_text(kode_row[5]) == "III"
    assert "Andi Pratama" in cell_text(row_by_label(rtm, "DOSEN PENGAMPU").findall(qn('w:tc'))[1])


def test_no_dangling_list_numbering():
    """An emptied paragraph keeping numPr renders as a stray bullet in Word."""
    doc = generate(PAYLOAD)
    dangling = []
    for idx, para in enumerate(doc.paragraphs):
        pPr = para._p.find(qn('w:pPr'))
        numbered = pPr is not None and pPr.find(qn('w:numPr')) is not None
        if numbered and not (para.text or "").strip():
            dangling.append(f"para[{idx}]")
    for t_idx, table in enumerate(doc.tables):
        for r_idx, row in enumerate(table.rows):
            for c_idx, tc in enumerate(row._tr.findall(qn('w:tc'))):
                for p in tc.findall(qn('w:p')):
                    pPr = p.find(qn('w:pPr'))
                    numbered = pPr is not None and pPr.find(qn('w:numPr')) is not None
                    text = "".join("".join(t.text or "" for t in r.findall(qn('w:t')))
                                   for r in p.findall(qn('w:r'))).strip()
                    if numbered and not text:
                        dangling.append(f"tbl{t_idx}[R{r_idx}C{c_idx}]")
    assert dangling == [], f"dangling numbering at: {dangling}"


def test_structure_preserved():
    doc = generate(PAYLOAD)
    assert [len(t.rows) for t in doc.tables] == [44, 25, 11, 8]
    sizes = {
        r.find(qn('w:rPr')).find(qn('w:sz')).get(qn('w:val'))
        for t in doc.tables for row in t.rows
        for tc in row._tr.findall(qn('w:tc')) for p in tc.findall(qn('w:p'))
        for r in p.findall(qn('w:r'))
        if r.find(qn('w:rPr')) is not None and r.find(qn('w:rPr')).find(qn('w:sz')) is not None
    }
    assert sizes, "no explicit run sizes survived"


def template_section_count() -> int:
    return len(Document(str(app_module.TEMPLATE_PATH)).sections)


def test_section_count_never_changes():
    """Section defines page size/orientation/margins.

    Growing a narrative block clones a paragraph, and the last paragraph of a
    section carries w:sectPr inside its pPr. Copying it silently adds a section
    and splits the page layout, so the count is asserted explicitly.
    """
    doc = generate(PAYLOAD)
    assert len(doc.sections) == template_section_count()


def test_long_narrative_keeps_layout_and_prints_every_item():
    """Long lists force repeated paragraph cloning — the path that broke layout."""
    payload = {"rps_draft": dict(PAYLOAD["rps_draft"])}
    payload["rps_draft"].update({
        "program_mission": [f"Misi nomor {i} yang dirumuskan cukup panjang" for i in range(1, 21)],
        "program_graduate_profile": [f"Profil Lulusan {i}" for i in range(1, 26)],
        "program_cpl": [
            {"code": f"CPL{i}", "description": f"Capaian pembelajaran lulusan nomor {i} yang memadai"}
            for i in range(1, 21)
        ],
    })
    doc = generate(payload)

    assert len(doc.sections) == template_section_count()
    assert [len(t.rows) for t in doc.tables] == [44, 25, 11, 8]

    def block(heading: str, stop: str) -> list[str]:
        out, seen = [], False
        for para in doc.paragraphs:
            text = (para.text or "").strip()
            if text == heading:
                seen = True
                continue
            if seen and text:
                if text == stop:
                    break
                out.append(text)
        return out

    assert len(block("Misi", "Profil Lulusan")) == 20
    # Satu baris judul "Profil lulusan <prodi>:" mendahului 25 butir.
    assert len(block("Profil Lulusan", "Capaian Pembelajaran Lulusan")) == 26
    assert len(block("Capaian Pembelajaran Lulusan", "Analisis Pembelajaran")) == 20


def test_cpl_beyond_template_capacity_is_not_silently_dropped():
    """Template hanya menyediakan 2 baris CPL, 4 CPMK, dan 7 Sub-CPMK.

    Kurikulum nyata bisa melebihi itu. Baris harus ditambah, bukan isinya
    dipotong — CPL yang hilang dari dokumen tanpa peringatan adalah kehilangan
    data yang tidak terlihat sampai dokumen dibaca manual.
    """
    payload = {"rps_draft": dict(PAYLOAD["rps_draft"])}
    payload["rps_draft"].update({
        "cpl": [{"code": f"CPL{i}", "description": f"Capaian lulusan nomor {i}"} for i in range(1, 6)],
        "cpmk": [{"code": f"CPMK {i}", "description": f"Capaian mata kuliah nomor {i}"} for i in range(1, 7)],
        "sub_cpmk": [{"code": f"Sub-CPMK-{i}", "description": f"Sub capaian nomor {i}"} for i in range(1, 10)],
    })
    doc = generate(payload)

    codes = []
    for row in doc.tables[0].rows:
        cells = row._tr.findall(qn('w:tc'))
        if len(cells) < 3:
            continue
        code = cell_text(cells[1]).strip()
        if re.match(r"^(CPL\d|CPMK \d|Sub-CPMK-\d)$", code):
            codes.append(code)

    for i in range(1, 6):
        assert f"CPL{i}" in codes, f"CPL{i} hilang dari dokumen"
    for i in range(1, 7):
        assert f"CPMK {i}" in codes, f"CPMK {i} hilang dari dokumen"
    for i in range(1, 10):
        assert f"Sub-CPMK-{i}" in codes, f"Sub-CPMK-{i} hilang dari dokumen"

    # Struktur halaman tetap utuh meski baris ditambah.
    assert len(doc.sections) == template_section_count()
    assert len(doc.tables) == 4


def test_cpl_category_does_not_reach_the_document():
    """`category` hanya metadata klasifikasi; hanya deskripsi yang tercetak."""
    payload = {"rps_draft": dict(PAYLOAD["rps_draft"])}
    payload["rps_draft"]["program_cpl"] = [
        {"code": "CPL1", "description": "Beretika informatika dalam praktik keilmuan", "category": "sikap"},
        {"code": "CPL2", "description": "Menguasai konsep teoretis algoritma", "category": "pengetahuan"},
    ]
    doc = generate(payload)
    texts = [(p.text or "").strip() for p in doc.paragraphs]
    assert "Beretika informatika dalam praktik keilmuan" in texts
    for where, text in all_text_nodes(doc):
        assert "keterampilan_umum" not in text
        assert "sikap" not in text.lower().split(), f"kategori ikut tercetak di {where}"



def test_empty_payload_clears_template_prose():
    """A draft with no content must not inherit the template's course content."""
    payload = {"rps_draft": dict(PAYLOAD["rps_draft"])}
    payload["rps_draft"].update({
        "description": "", "bahan_kajian": [], "pustaka_utama": [],
        "pustaka_pendukung": [], "cpl": [], "cpmk": [], "sub_cpmk": [],
    })
    doc = generate(payload)
    tbl0 = doc.tables[0]
    assert cell_text(row_by_label(tbl0, "Deskripsi Singkat MK").findall(qn('w:tc'))[1]) == ""
    assert cell_text(row_by_label(tbl0, "Bahan Kajian").findall(qn('w:tc'))[1]) == ""
    leaks = [(where, text) for where, text in all_text_nodes(doc) if LEAK_RE.search(text)]
    assert leaks == [], f"template content leaked: {leaks}"


def test_missing_anchor_fails_loudly(monkeypatch):
    """A template revision must raise, never silently write into the wrong row."""
    import docx_service.app as module

    monkeypatch.setattr(module, "TEMPLATE_PATH", module.TEMPLATE_PATH.with_name("missing.docx"))
    response = client.post("/generate", json=PAYLOAD)
    assert response.status_code == 500


@pytest.mark.parametrize(
    "raw,expected",
    [
        (["Systems Analyst", "Software Developer"], ["Systems Analyst", "Software Developer"]),
        (
            ["Communicator: Melakukan komunikasi. Health Educator: Melakukan edukasi."],
            ["Communicator: Melakukan komunikasi.", "Health Educator: Melakukan edukasi."],
        ),
        # Unsplittable run is left intact rather than mangled into "I" + "T Trainer".
        (["Systems Analyst Database Administrator IT Trainer"],
         ["Systems Analyst Database Administrator IT Trainer"]),
        ('["Data Analyst","Web Developer"]', ["Data Analyst", "Web Developer"]),
        ([], []),
    ],
)
def test_split_profile_items(raw, expected):
    assert split_profile_items(raw) == expected
