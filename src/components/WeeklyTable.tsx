import { useEffect, useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Banner } from "./ui/Banner";
import { Badge } from "./ui/Badge";
import { ProgressBar } from "./ui/ProgressBar";
import { Card } from "./ui/Card";

export type WeeklyRow = {
  week: string;
  weight: number;
  is_merged: boolean;
  // legacy 5-field (compat server/AI lama)
  material: string;
  method: string;
  experience: string;
  assessment_criteria: string;
  // 1:1 template 8 kolom (tc0-7) — prefer verbatim untuk DOCX
  sub_cpmk?: string | null;
  indikator?: string | null;
  kriteria?: string | null;
  daring?: string | null;
  luring?: string | null;
  materi?: string | null;
};

function deriveFromLegacy(r: Partial<WeeklyRow>): Required<Pick<WeeklyRow, "sub_cpmk" | "indikator" | "kriteria" | "daring" | "luring" | "materi">> {
  const material = (r.materi as string) ?? (r.material as string) ?? "";
  const method = (r.luring as string) ?? (r.method as string) ?? "";
  const exp = (r.indikator as string) ?? (r.experience as string) ?? "";
  const crit = (r.kriteria as string) ?? (r.assessment_criteria as string) ?? "";
  const sub_cpmk = (r.sub_cpmk ?? "").trim() || (material && !/mampu|mahasiswa/i.test(material) ? `Mahasiswa mampu menjelaskan tentang ${material}` : material || "-");
  const indikator = (r.indikator ?? "").trim() || (material ? `Ketepatan dalam menjelaskan ${material} | Keaktifan dalam diskusi | Kepatuhan terhadap kontrak mata kuliah` : exp || "-");
  const kriteria = (r.kriteria ?? "").trim() || crit || "Rubrik penilaian presentasi kelompok (lampiran 1) | Rubrik partisipasi kelas (lampiran 2) | Absensi";
  const daring = (r.daring ?? "").trim() || "Menyesuaikan perkembangan pandemic COVID-19";
  let luring = (r.luring ?? "").trim();
  if (!luring) {
    luring = method;
    if (exp && !method.includes(exp)) luring = `${method} | ${exp}`.trim();
    if (luring && !luring.includes("TM")) luring = `${luring} [TM 1x(4x50”)]`;
    if (!luring.trim()) luring = 'TM 1×(4×50")';
  }
  const materi = (r.materi ?? "").trim() || material || "-";
  return { sub_cpmk, indikator, kriteria, daring, luring, materi };
}

function normalizeRow(row: WeeklyRow): WeeklyRow {
  const d = deriveFromLegacy(row);
  return {
    ...row,
    sub_cpmk: row.sub_cpmk ?? d.sub_cpmk,
    indikator: row.indikator ?? d.indikator,
    kriteria: row.kriteria ?? d.kriteria,
    daring: row.daring ?? d.daring,
    luring: row.luring ?? d.luring,
    materi: row.materi ?? d.materi,
  };
}

function syncLegacy(row: WeeklyRow): WeeklyRow {
  // keep legacy mirrors verbatim — server/AI lama hanya baca legacy
  const next = { ...row };
  const materi = (next.materi ?? next.material ?? "").toString();
  const luring = (next.luring ?? next.method ?? "").toString();
  const kriteria = (next.kriteria ?? next.assessment_criteria ?? "").toString();
  const indikator = (next.indikator ?? next.experience ?? "").toString();
  next.material = materi;
  next.materi = materi;
  next.method = luring;
  next.luring = luring;
  next.assessment_criteria = kriteria;
  next.kriteria = kriteria;
  next.experience = indikator;
  next.indikator = indikator;
  return next;
}

const default9: WeeklyRow[] = [
  { week: "1", material: "Konsep sel dan genetika", materi: "Konsep sel dan genetika", sub_cpmk: "Mahasiswa mampu menjelaskan tentang konsep sel dan genetika (CPMK1)", indikator: "Ketepatan dalam menjelaskan konsep sel dan genetika | Keaktifan dalam diskusi | Kepatuhan terhadap kontrak mata kuliah", kriteria: "Rubrik penilaian presentasi kelompok (lampiran 1) | Rubrik partisipasi kelas (lampiran 2) | Absensi", daring: "Menyesuaikan perkembangan pandemic COVID-19", luring: 'Kuliah | Diskusi studi kasus (case methode) | [TM 1x(4×50”)]', method: 'TM 1×(4×50")', experience: "Kuliah | Diskusi", assessment_criteria: "Rubrik presentasi | Keaktifan dalam diskusi", weight: 5, is_merged: false },
  { week: "2", material: "Biomekanika dan biolistrik", materi: "Biomekanika dan biolistrik", sub_cpmk: "Mahasiswa mampu menjelaskan tentang prinsip fisika (biomekanika & biolistrik) (CPMK2)", indikator: "Ketepatan memahami biomekanika dalam keperawatan dan konsep biolistrik", kriteria: "Rubrik penilaian mind map (lampiran 3) | Ujian tertulis", daring: "Menyesuaikan perkembangan pandemic COVID-19", luring: 'Kuliah | Jigsaw | [TM 1x(4×50”)]', method: 'TM 1×(4×50")', experience: "Kuliah | Praktikum", assessment_criteria: "Rubrik mind map", weight: 5, is_merged: false },
  { week: "3, 4", material: "Biokimia dalam tubuh", materi: "Biokimia dalam tubuh", sub_cpmk: "Mahasiswa mampu menjelaskan tentang komponen biokimia dalam tubuh (CPMK3)", indikator: "Ketepatan memahami komponen biokimia: keseimbangan asam-basa, cairan tubuh, metabolisme", kriteria: "Ketepatan dalam memilih & menghitung gizi | Rubrik presentasi kelompok", daring: "Menyesuaikan perkembangan pandemic COVID-19", luring: 'Kuliah | Jigsaw | [TM 1x(2×50”)] | [BM+PT: (1+1)x(2×60”)]', method: 'TM 1×(2×50") + BM+PT', experience: "Kuliah", assessment_criteria: "Kuis", weight: 10, is_merged: false },
  { week: "5, 6, 7", material: "Zat gizi makro dan mikro", materi: "Zat gizi makro dan mikro", sub_cpmk: "Mahasiswa mampu menjelaskan tentang zat gizi & kebutuhan individu", indikator: "Ketepatan menyusun rangkuman zat gizi, angka kecukupan, kebutuhan individu", kriteria: "Rubrik penilaian presentasi kelompok (lampiran 1) | Rubrik partisipasi kelas (lampiran 2)", daring: "Menyesuaikan perkembangan pandemic COVID-19", luring: 'Praktikum | Jigsaw | [TM 1x(2×50”)] | [BM+PT: (1+1)x(2×60”)]', method: 'TM 1×(2×50") + BM+PT (1+1)×(2×60")', experience: "Praktikum", assessment_criteria: "Laporan", weight: 20, is_merged: false },
  { week: "8", material: "UJIAN MID SEMESTER", materi: "UJIAN MID SEMESTER", sub_cpmk: "UJIAN MID SEMESTER", indikator: "-", kriteria: "-", daring: "-", luring: "-", method: "-", experience: "-", assessment_criteria: "-", weight: 0, is_merged: true },
  { week: "9, 10, 11", material: "Anatomi dasar dan jaringan", materi: "Anatomi dasar dan jaringan", sub_cpmk: "Mahasiswa mampu menjelaskan tentang terminologi & anatomi persistem", indikator: "Ketepatan menjelaskan anatomi dasar, posisi tubuh, sel & jaringan", kriteria: "Rubrik penilaian presentasi kelompok | Rubrik partisipasi kelas", daring: "Menyesuaikan perkembangan pandemic COVID-19", luring: 'Kuliah | Jigsaw | [TM 1x(4×50”)]', method: 'TM 1×(4×50")', experience: "Kuliah", assessment_criteria: "Presentasi", weight: 30, is_merged: false },
  { week: "12, 13", material: "Sistem muskuloskeletal", materi: "Sistem muskuloskeletal", sub_cpmk: "Mahasiswa mampu menjelaskan tentang sistem muskuloskeletal", indikator: "Ketepatan menjelaskan muskuloskeletal | Keaktifan dalam diskusi", kriteria: "Rubrik penilaian mind map | Ujian tertulis", daring: "Menyesuaikan perkembangan pandemic COVID-19", luring: 'Kuliah | Jigsaw | [TM 1x(4×50”)]', method: 'TM 1×(4×50")', experience: "Kuliah", assessment_criteria: "Presentasi", weight: 10, is_merged: false },
  { week: "14, 15", material: "Sistem kardiovaskular", materi: "Sistem kardiovaskular", sub_cpmk: "Mahasiswa mampu menjelaskan tentang sistem kardiovaskular & keseimbangan cairan", indikator: "Ketepatan menjelaskan kardiovaskular, asam-basa, regulasi hormonal", kriteria: "Rubrik penilaian mind map | Ujian tertulis", daring: "Menyesuaikan perkembangan pandemic COVID-19", luring: 'Kuliah | Jigsaw | [TM 1x(4×50”)]', method: 'TM 1×(4×50")', experience: "Kuliah", assessment_criteria: "Presentasi", weight: 20, is_merged: false },
  { week: "16", material: "UJIAN FINAL SEMESTER", materi: "UJIAN FINAL SEMESTER", sub_cpmk: "UJIAN FINAL SEMESTER", indikator: "-", kriteria: "-", daring: "-", luring: "-", method: "-", experience: "-", assessment_criteria: "-", weight: 0, is_merged: true },
];

const colHelper = createColumnHelper<WeeklyRow>();

export function WeeklyTable({ value, onChange, onSave }: { value?: WeeklyRow[]; onChange?: (v: WeeklyRow[]) => void; onSave?: (v: WeeklyRow[]) => Promise<void> | void }) {
  const initial = useMemo(() => {
    const src = value && value.length ? value : default9;
    return src.map(normalizeRow);
  }, [value ? JSON.stringify(value) : "default"]);

  const [rows, setRows] = useState<WeeklyRow[]>(initial);
  useEffect(() => {
    setRows(initial);
  }, [initial]);

  const sum = useMemo(() => rows.filter((r) => !r.is_merged).reduce((s, r) => s + (r.weight ?? 0), 0), [rows]);
  const ok = sum === 100;
  const warn = !ok ? `Σ non-merge = ${sum} (harus 100)` : "Σ = 100 ✓";

  const emit = (next: WeeklyRow[]) => {
    const synced = next.map(syncLegacy);
    setRows(synced);
    onChange?.(synced);
  };

  const updateField = (idx: number, field: keyof WeeklyRow, val: string | number | boolean) => {
    const n = [...rows];
    (n[idx] as unknown as Record<string, unknown>)[field] = val;
    // keep mirrors
    if (field === "materi") { n[idx].material = String(val); n[idx].materi = String(val); }
    if (field === "material") { n[idx].materi = String(val); }
    if (field === "luring") { n[idx].method = String(val); }
    if (field === "method") { n[idx].luring = String(val); }
    if (field === "kriteria") { n[idx].assessment_criteria = String(val); }
    if (field === "assessment_criteria") { n[idx].kriteria = String(val); }
    if (field === "indikator") { n[idx].experience = String(val); }
    if (field === "experience") { n[idx].indikator = String(val); }
    emit(n);
  };

  const cols = useMemo(
    () => [
      colHelper.accessor("week", {
        header: () => <div className="text-center leading-tight"><div className="font-semibold">(1)</div><div className="text-[11px]">Pertemuan<br />Ke-</div></div>,
        cell: (c) => (
          <input
            className={`w-[72px] rounded border px-2 py-1 text-center text-xs font-mono ${c.row.original.is_merged ? "bg-amber-50 font-bold text-[#1E3A5F]" : "bg-white"}`}
            value={c.getValue()}
            onChange={(e) => updateField(c.row.index, "week", e.target.value)}
          />
        ),
        size: 80,
      }),
      colHelper.accessor("sub_cpmk", {
        header: () => <div className="text-center leading-tight"><div className="font-semibold">(2)</div><div className="text-[11px]">Sub-CPMK</div><div className="text-[10px] font-normal text-slate-500">(Kemampuan akhir)</div></div>,
        cell: (c) =>
          c.row.original.is_merged ? (
            <span className="text-xs text-slate-400">—</span>
          ) : (
            <TextAreaCell value={(c.getValue() as string) ?? ""} onSave={(v) => updateField(c.row.index, "sub_cpmk", v)} minW={220} />
          ),
        size: 240,
      }),
      colHelper.accessor("indikator", {
        header: () => <div className="text-center leading-tight"><div className="font-semibold">(3)</div><div className="text-[11px]">Indikator</div></div>,
        cell: (c) => (c.row.original.is_merged ? <span className="text-xs text-slate-400">—</span> : <TextAreaCell value={(c.getValue() as string) ?? ""} onSave={(v) => updateField(c.row.index, "indikator", v)} minW={200} />),
        size: 220,
      }),
      colHelper.accessor("kriteria", {
        header: () => <div className="text-center leading-tight"><div className="font-semibold">(4)</div><div className="text-[11px]">Kriteria &<br />Bentuk</div></div>,
        cell: (c) => (c.row.original.is_merged ? <span className="text-xs text-slate-400">—</span> : <TextAreaCell value={(c.getValue() as string) ?? ""} onSave={(v) => updateField(c.row.index, "kriteria", v)} minW={200} />),
        size: 220,
      }),
      colHelper.accessor("daring", {
        header: () => <div className="text-center leading-tight"><div className="font-semibold">(5)</div><div className="text-[11px]">Daring<br />(online)</div></div>,
        cell: (c) => (c.row.original.is_merged ? <span className="text-xs text-slate-400">—</span> : <TextAreaCell value={(c.getValue() as string) ?? ""} onSave={(v) => updateField(c.row.index, "daring", v)} minW={160} />),
        size: 170,
      }),
      colHelper.accessor("luring", {
        header: () => <div className="text-center leading-tight"><div className="font-semibold">(6)</div><div className="text-[11px]">Luring<br />(offline)</div><div className="text-[10px] font-normal text-slate-500">[TM 1x...]</div></div>,
        cell: (c) => (c.row.original.is_merged ? <span className="text-xs text-slate-400">—</span> : <TextAreaCell value={(c.getValue() as string) ?? ""} onSave={(v) => updateField(c.row.index, "luring", v)} minW={200} />),
        size: 220,
      }),
      colHelper.accessor("materi", {
        header: () => <div className="text-center leading-tight"><div className="font-semibold">(7)</div><div className="text-[11px]">Materi<br />Pembelajaran</div><div className="text-[10px] font-normal text-slate-500">[Pustaka]</div></div>,
        cell: (c) => (c.row.original.is_merged ? <span className="text-xs text-slate-400">—</span> : <TextAreaCell value={(c.getValue() as string) ?? ""} onSave={(v) => updateField(c.row.index, "materi", v)} minW={200} />),
        size: 220,
      }),
      colHelper.accessor("weight", {
        header: () => <div className="text-center leading-tight"><div className="font-semibold">(8)</div><div className="text-[11px]">Bobot<br />(%)</div></div>,
        cell: (c) => <WeightCell value={c.getValue() as number} merged={c.row.original.is_merged} onSave={(v) => updateField(c.row.index, "weight", v)} />,
        size: 90,
      }),
    ],
    [rows],
  );

  const table = useReactTable({ data: rows, columns: cols as never, getCoreRowModel: getCoreRowModel() });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">Rencana Pembelajaran Mingguan — 9 baris / 16 minggu (R35-R43)</div>
          <div className="text-xs text-slate-500">1:1 template — 8 kolom (1) Minggu (2) Sub-CPMK (3) Indikator (4) Kriteria (5) Daring (6) Luring (7) Materi (8) Bobot. Week 8/16 merged lock.</div>
        </div>
        <Badge variant={ok ? "success" : "danger"}>{warn}</Badge>
      </div>
      <div className="mt-2">
        <ProgressBar value={sum} max={100} />
      </div>
      {!ok && (
        <div className="mt-3">
          <Banner status="error">{warn} — bobot non-merge harus 100. UTS/UAS weight 0.</Banner>
        </div>
      )}
      {rows.some((r) => (r.daring ?? "").includes("Menyesuaikan perkembangan pandemic COVID-19")) && (
        <div className="mt-2">
          <Banner status="warning">Kolom Daring mengandung hook pandemic — sesuaikan jika luring penuh.</Banner>
        </div>
      )}

      {/* Scroll container — horizontal scroll, sticky first col */}
      <div className="mt-3 overflow-auto rounded-lg border" style={{ maxHeight: "65vh" }}>
        <table className="w-full min-w-[1320px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              {table.getHeaderGroups()[0].headers.map((h) => (
                <th key={h.id} className="border-b border-slate-200 px-2 py-2 align-bottom font-medium" style={{ width: h.getSize() }}>
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) =>
              row.original.is_merged ? (
                <tr key={row.id} className="border-t bg-amber-50/60">
                  <td className="sticky left-0 z-[1] border-r bg-amber-50/60 px-2 py-2 align-top">
                    <input className="w-[72px] rounded border bg-white px-2 py-1 text-center text-xs font-mono font-bold text-[#1E3A5F]" value={row.original.week} onChange={(e) => updateField(row.index, "week", e.target.value)} />
                  </td>
                  <td colSpan={7} className="px-3 py-3 text-center">
                    <span className="text-sm font-bold tracking-wide text-[#1E3A5F]">{(row.original.materi || row.original.material || (row.original.week === "8" ? "UJIAN MID SEMESTER" : "UJIAN FINAL SEMESTER")).toString().toUpperCase()}</span>
                    <span className="ml-2">
                      <Badge variant="warning">MERGED — Bobot 0</Badge>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} className="border-t hover:bg-slate-50/50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={`px-2 py-2 align-top ${cell.column.id === "week" ? "sticky left-0 z-[1] border-r bg-white" : ""}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-slate-50 font-medium">
              <td className="sticky left-0 bg-slate-50 px-2 py-2">Σ non-merge</td>
              <td colSpan={6} className="px-2 py-2 text-xs text-slate-500">
                8 kolom template — edit tiap tc verbatim; sinkron otomatis ke legacy field untuk kompatibilitas AI lama &amp; DOCX.
              </td>
              <td className="px-2 py-2 text-center">
                <span className={ok ? "text-emerald-700" : "text-red-600"}>{sum}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded-full border px-4 py-2 text-sm" onClick={() => emit(default9.map(normalizeRow))}>
          Reset contoh 9 (8 kolom)
        </button>
        {onSave && (
          <button
            className="rounded-full bg-[#1E3A5F] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!ok}
            onClick={() => onSave(rows)}
          >
            {ok ? "Simpan 9 baris" : "Perbaiki bobot dulu"}
          </button>
        )}
      </div>
      <div className="mt-2 text-xs leading-relaxed text-slate-500">
        Merge lock: baris 8 <code className="rounded bg-slate-100 px-1">is_merged true</code> week 8 UTS &amp; week 16 UAS — jangan pecah. Kolom (5) Daring hook{" "}
        <code className="rounded bg-slate-100 px-1">Menyesuaikan perkembangan pandemic COVID-19</code> &amp; (6) Luring must include{" "}
        <code className="rounded bg-slate-100 px-1">TM 1×(4×50&quot;)</code> / <code className="rounded bg-slate-100 px-1">BM+PT (1+1)×(2×60&quot;)</code>. Bobot Σ non-merge = 100.
      </div>
    </Card>
  );
}

function TextAreaCell({ value, onSave, minW = 200 }: { value: string; onSave: (v: string) => void; minW?: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      className="rounded border px-2 py-1 text-xs leading-relaxed focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
      style={{ minWidth: minW, width: "100%", minHeight: 56 }}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onSave(v)}
      rows={2}
    />
  );
}
function WeightCell({ value, merged, onSave }: { value: number; merged: boolean; onSave: (v: number) => void }) {
  if (merged) return <span className="text-center text-xs text-slate-400">0 (merge)</span>;
  return <input type="number" className="w-[72px] rounded border px-2 py-1 text-center text-xs" value={value} onChange={(e) => onSave(Number(e.target.value))} min={0} max={100} />;
}
