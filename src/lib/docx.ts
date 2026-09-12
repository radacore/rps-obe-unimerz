import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, TextRun, HeadingLevel, BorderStyle } from "docx";

export type WeeklyRow = {
  week: string; weight: number; is_merged: boolean;
  // legacy 5-field (compat)
  material: string; method: string; experience: string; assessment_criteria: string;
  // 1:1 template 8 kolom (prefer verbatim; when present override derived)
  sub_cpmk?: string | null; indikator?: string | null; kriteria?: string | null;
  daring?: string | null; luring?: string | null; materi?: string | null;
};
type Draft = { course_name: string; course_code: string; course_cluster?: string | null; faculty?: string | null; study_program?: string | null; sks_total: number; sks_theory: number; sks_practice: number; semester: string; preparation_date: string | Date; lecturers: { name:string; role:string; nidn:string }[]; weekly_plans: WeeklyRow[] };

function r(text: string, opts?: { bold?: boolean; size?: number }) {
  return new TextRun({ text, bold: opts?.bold, size: opts?.size ?? 18, font: "Times New Roman" });
}

function deriveRow(row: WeeklyRow): { sub_cpmk:string; indikator:string; kriteria:string; daring:string; luring:string; materi:string } {
  const material = row.material ?? row.materi ?? "";
  const method = row.method ?? row.luring ?? "";
  const exp = row.experience ?? "";
  const crit = row.assessment_criteria ?? "";
  let sub_cpmk = (row.sub_cpmk ?? "").trim();
  if (!sub_cpmk) {
    sub_cpmk = material && !/mampu|mahasiswa/i.test(material) ? `Mahasiswa mampu menjelaskan tentang ${material}` : (material || "-");
  }
  let indikator = (row.indikator ?? "").trim();
  if (!indikator) indikator = material ? `Ketepatan dalam menjelaskan ${material} | Keaktifan dalam diskusi | Kepatuhan terhadap kontrak mata kuliah` : (exp || "-");
  let kriteria = (row.kriteria ?? "").trim() || crit || "Rubrik penilaian presentasi kelompok (lampiran 1) | Rubrik partisipasi kelas (lampiran 2) | Absensi";
  let daring = (row.daring ?? "").trim() || "Menyesuaikan perkembangan pandemic COVID-19";
  let luring = (row.luring ?? "").trim();
  if (!luring) {
    luring = method;
    if (exp && !method.includes(exp)) luring = `${method} | ${exp}`.trim();
    if (!luring.includes("TM")) luring = `${luring} [TM 1x(4x50\u201d)]`.trim();
    if (!luring) luring = 'TM 1×(4×50")';
  }
  let materi = (row.materi ?? "").trim() || material || "-";
  return { sub_cpmk, indikator, kriteria, daring, luring, materi };
}

export async function buildDocxBuffer(draft: Draft): Promise<Buffer> {
  const weekly: WeeklyRow[] = draft.weekly_plans?.length ? draft.weekly_plans : [
    { week:"1", material:"Pendahuluan", method:'TM 1×(4×50")', experience:"Kuliah | Diskusi", assessment_criteria:"Rubrik", weight:5, is_merged:false, sub_cpmk:"Mahasiswa mampu menjelaskan tentang Pendahuluan", indikator:"Ketepatan dalam menjelaskan Pendahuluan | Keaktifan dalam diskusi", kriteria:"Rubrik presentasi", daring:"Menyesuaikan perkembangan pandemic COVID-19", luring:'TM 1×(4×50") | Kuliah | Diskusi', materi:"Pendahuluan" },
    { week:"2", material:"Sel & Jaringan", method:'TM 1×(4×50")', experience:"Kuliah | Praktikum", assessment_criteria:"Kuis", weight:5, is_merged:false, sub_cpmk:"Mahasiswa mampu menjelaskan tentang Sel & Jaringan", indikator:"Ketepatan dalam menjelaskan Sel & Jaringan", kriteria:"Kuis", daring:"Menyesuaikan perkembangan pandemic COVID-19", luring:'TM 1×(4×50") | Kuliah | Praktikum', materi:"Sel & Jaringan" },
    { week:"3, 4", material:"Sistem Organ I", method:'TM 1×(4×50")', experience:"Kuliah", assessment_criteria:"Tugas", weight:10, is_merged:false, sub_cpmk:"Mahasiswa mampu menjelaskan tentang Sistem Organ I", indikator:"Ketepatan dalam menjelaskan Sistem Organ I", kriteria:"Tugas", daring:"Menyesuaikan perkembangan pandemic COVID-19", luring:'TM 1×(4×50") | Kuliah', materi:"Sistem Organ I" },
    { week:"5, 6, 7", material:"Sistem Organ II + Menyesuaikan perkembangan pandemic COVID-19", method:'TM 1×(2×50") + BM+PT (1+1)×(2×60")', experience:"Praktikum", assessment_criteria:"Laporan", weight:20, is_merged:false, sub_cpmk:"Mahasiswa mampu menjelaskan tentang Sistem Organ II", indikator:"Ketepatan dalam menjelaskan Sistem Organ II", kriteria:"Laporan", daring:"Menyesuaikan perkembangan pandemic COVID-19", luring:'TM 1×(2×50") + BM+PT (1+1)×(2×60") | Praktikum', materi:"Sistem Organ II" },
    { week:"8", material:"UJIAN MID SEMESTER", method:"Daring/Luring", experience:"Ujian tulis", assessment_criteria:"Soal UTS", weight:0, is_merged:true },
    { week:"9, 10, 11", material:"Patofisiologi", method:'TM 1×(4×50")', experience:"Kuliah", assessment_criteria:"Presentasi", weight:30, is_merged:false, sub_cpmk:"Mahasiswa mampu menjelaskan tentang Patofisiologi", indikator:"Ketepatan dalam menjelaskan Patofisiologi", kriteria:"Presentasi", daring:"Menyesuaikan perkembangan pandemic COVID-19", luring:'TM 1×(4×50") | Kuliah', materi:"Patofisiologi" },
    { week:"12, 13", material:"Farmakologi", method:'TM 1×(4×50")', experience:"Kuliah", assessment_criteria:"Kuis", weight:10, is_merged:false, sub_cpmk:"Mahasiswa mampu menjelaskan tentang Farmakologi", indikator:"Ketepatan dalam menjelaskan Farmakologi", kriteria:"Kuis", daring:"Menyesuaikan perkembangan pandemic COVID-19", luring:'TM 1×(4×50") | Kuliah', materi:"Farmakologi" },
    { week:"14, 15", material:"Integrasi", method:'TM 1×(4×50")', experience:"Bedside teaching", assessment_criteria:"OSCE", weight:20, is_merged:false, sub_cpmk:"Mahasiswa mampu menjelaskan tentang Integrasi", indikator:"Ketepatan dalam menjelaskan Integrasi", kriteria:"OSCE", daring:"Menyesuaikan perkembangan pandemic COVID-19", luring:'TM 1×(4×50") | Bedside teaching', materi:"Integrasi" },
    { week:"16", material:"UJIAN FINAL SEMESTER", method:"Daring/Luring", experience:"Ujian tulis", assessment_criteria:"Soal UAS", weight:0, is_merged:true },
  ];

  const fakultasLine = (draft.faculty ?? "").toString().toUpperCase();
  const rawProdi = (draft.study_program ?? "").toString();
  const displayProdi = /^(S1|S2|S3|D3|D4) /.test(rawProdi) ? `Program Studi ${rawProdi}` : rawProdi;
  const kop = new Paragraph({ alignment: AlignmentType.CENTER, children: [r("UNIVERSITAS MEGAREZKY",{bold:true}), r(`\n${fakultasLine}`), r(`\n${displayProdi}`), r("\nRENCANA PEMBELAJARAN SEMESTER (RPS)",{bold:true}) ]});
  const identitas = new Paragraph({ children: [r(`${draft.course_name} (${draft.course_code}) — SKS ${draft.sks_theory}/${draft.sks_practice} total ${draft.sks_total} — Semester ${draft.semester} — Tgl ${String(draft.preparation_date).slice(0,10)} — Rumpun ${draft.course_cluster ?? rawProdi}`)] });
  const dosenHeading = new Paragraph({ heading: HeadingLevel.HEADING_2, children: [r("Dosen Pengampu")] });
  const dosenBullets = (draft.lecturers ?? []).map(l => new Paragraph({ bullet: { level: 0 }, children: [r(`${l.name} (${l.role}, NIDN ${l.nidn})`)] }));
  const weeklyHeading = new Paragraph({ heading: HeadingLevel.HEADING_2, children: [r("Rencana Pembelajaran Mingguan — 9 baris / 16 minggu (R35-R43) — JS fallback (template fidelity via Python service disarankan)")] });

  // JS fallback mirrors template 8 columns: (1) Minggu (2) Sub-CPMK (3) Indikator (4) Kriteria (5) Daring (6) Luring (7) Materi (8) Bobot — header 1 row for fallback
  const headerRow = new TableRow({ children: ["(1)\nMinggu","(2)\nSub-CPMK","(3)\nIndikator","(4)\nKriteria & Bentuk","(5)\nDaring","(6)\nLuring","(7)\nMateri","(8)\nBobot"].map(t => new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [r(t,{bold:true, size:16})] })], shading: { fill: "1E3A5F", color:"auto", type: "clear" } })) });

  const rows = weekly.map(row => {
    if (row.is_merged) {
      return new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [r(row.week,{bold:true})] })] }),
        new TableCell({ columnSpan: 7, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [r((row.material || row.materi || (row.week==="8"?"UJIAN MID SEMESTER":"UJIAN FINAL SEMESTER")).toString().toUpperCase(),{bold:true})] })] }),
      ]});
    }
    const d = deriveRow(row);
    return new TableRow({ children: [
      new TableCell({ children: [new Paragraph({ children: [r(row.week)] })] }),
      new TableCell({ children: [new Paragraph({ children: [r(d.sub_cpmk)] })] }),
      new TableCell({ children: [new Paragraph({ children: [r(d.indikator)] })] }),
      new TableCell({ children: [new Paragraph({ children: [r(d.kriteria)] })] }),
      new TableCell({ children: [new Paragraph({ children: [r(d.daring)] })] }),
      new TableCell({ children: [new Paragraph({ children: [r(d.luring)] })] }),
      new TableCell({ children: [new Paragraph({ children: [r(d.materi)] })] }),
      new TableCell({ children: [new Paragraph({ alignment:AlignmentType.CENTER, children: [r(String(row.weight))] })] }),
    ]});
  });

  const sum = weekly.filter(r=>!r.is_merged).reduce((s,r)=>s+r.weight,0);
  const sumPara = new Paragraph({ children: [r(`Σ bobot non-merge = ${sum} (harus 100) — ${sum===100 ? "✓" : "PERBAIKI"}`, { bold: true })] });

  const table = new Table({
    rows: [headerRow, ...rows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top:{style: BorderStyle.SINGLE, size:1, color:"AAAAAA"}, bottom:{style: BorderStyle.SINGLE, size:1, color:"AAAAAA"}, left:{style: BorderStyle.SINGLE, size:1, color:"AAAAAA"}, right:{style: BorderStyle.SINGLE, size:1, color:"AAAAAA"}, insideHorizontal:{style: BorderStyle.SINGLE, size:1, color:"AAAAAA"}, insideVertical:{style: BorderStyle.SINGLE, size:1, color:"AAAAAA"} },
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: "Times New Roman", size: 18 } } } },
    sections: [{ children: [kop, identitas, dosenHeading, ...dosenBullets, weeklyHeading, table, sumPara] }],
  });
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}
