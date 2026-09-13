import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiOk } from "@/lib/api";
import { fetchProgram, type Program } from "@/lib/programs";
import { WeeklyTable, type WeeklyRow } from "@/components/WeeklyTable";
import { AiGeneratePanel } from "@/components/AiGeneratePanel";
import { DocxPreview } from "@/components/DocxPreview";
import { TemplateEditor } from "@/components/TemplateEditor";
import { CONTOH_BAHAN_KAJIAN, CONTOH_CPL, CONTOH_CPMK, CONTOH_DESCRIPTION, CONTOH_PUSTAKA_PENDUKUNG, CONTOH_PUSTAKA_UTAMA, CONTOH_SUB_CPMK } from "@/lib/contoh";
import { useFaculties } from "@/lib/useFaculties";
import { Card } from "@/components/ui/Card";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Field } from "@astryxdesign/core/Field";
import { useEffect, useMemo, useState } from "react";
import type { ISODateString } from "@astryxdesign/core/Calendar";

type Cp = { code: string; description: string };
type Detail = {
  id: number;
  course_name: string;
  course_code: string;
  course_cluster: string | null;
  faculty: string | null;
  study_program: string | null;
  sks_total: number;
  sks_theory: number;
  sks_practice: number;
  semester: string;
  preparation_date: string;
  lecturers: { name: string; nidn: string; role: string }[];
  weekly_plans: WeeklyRow[];
  description?: string | null;
  bahan_kajian?: string[] | null;
  pustaka_utama?: string[] | null;
  pustaka_pendukung?: string[] | null;
  cpl?: Cp[] | null;
  cpmk?: Cp[] | null;
  sub_cpmk?: Cp[] | null;
  status: string;
  file_hash: string | null;
  ai_provider: string | null;
  ai_model: string | null;
};

export const Route = createFileRoute("/rps/$id")({
  component: RpsDetail,
});

function isoDate(v: string | Date): string {
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v).slice(0, 10); }
}

function RpsDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 4000);
    return () => clearTimeout(t);
  }, [msg, err]);

  const q = useQuery({ queryKey: ["rps", Number(id)], queryFn: () => api<ApiOk<Detail>>(`/api/rps/${id}`) });
  const d = q.data?.data;

  // preview rows: live before save
  const [previewRows, setPreviewRows] = useState<WeeklyRow[] | null>(null);
  const effectiveRows: WeeklyRow[] = previewRows ?? d?.weekly_plans ?? [];
  const weeklyKey = d?.weekly_plans ? JSON.stringify(d.weekly_plans) : "";
  useEffect(() => {
    if (!d?.weekly_plans?.length) return;
    if (previewRows === null) setPreviewRows(d.weekly_plans);
  }, [weeklyKey]);

  const localSum = useMemo(() => effectiveRows.filter((p) => !p.is_merged).reduce((s, p) => s + (p.weight ?? 0), 0), [effectiveRows]);
  const readyToGenerate = effectiveRows.length > 0 && localSum === 100;

  const [descLive, setDescLive] = useState<string | null>(null);
  const [bahanKajianLive, setBahanKajianLive] = useState<string[] | null>(null);
  const [pustakaUtamaLive, setPustakaUtamaLive] = useState<string[] | null>(null);
  const [pustakaPendLive, setPustakaPendLive] = useState<string[] | null>(null);
  const [cplLive, setCplLive] = useState<Cp[] | null>(null);
  const [cpmkLive, setCpmkLive] = useState<Cp[] | null>(null);
  const [subCpmkLive, setSubCpmkLive] = useState<Cp[] | null>(null);
  useEffect(() => {
    setDescLive(null);
    setBahanKajianLive(null);
    setPustakaUtamaLive(null);
    setPustakaPendLive(null);
    setCplLive(null);
    setCpmkLive(null);
    setSubCpmkLive(null);
  }, [d?.description, d?.bahan_kajian ? JSON.stringify(d.bahan_kajian) : "", d?.pustaka_utama ? JSON.stringify(d.pustaka_utama) : "", d?.pustaka_pendukung ? JSON.stringify(d.pustaka_pendukung) : "", d?.cpl ? JSON.stringify(d.cpl) : "", d?.cpmk ? JSON.stringify(d.cpmk) : "", d?.sub_cpmk ? JSON.stringify(d.sub_cpmk) : ""]);
  // effective values: live override > DB. CONTOH tidak lagi fallback otomatis (agar tidak bocor Keperawatan ke prodi lain).
  // Pratinjau kosong = isi via "Isi CONTOH 100%" (manual) atau AI Generate.
  const dbHasBahan = Array.isArray(d?.bahan_kajian) && (d!.bahan_kajian!.length > 0);
  const dbHasPustaka = Array.isArray(d?.pustaka_utama) && (d!.pustaka_utama!.length > 0);
  const dbHasPustakaPend = Array.isArray(d?.pustaka_pendukung) && (d!.pustaka_pendukung!.length > 0);
  const dbHasCpl = Array.isArray(d?.cpl) && (d!.cpl!.length > 0);
  const dbHasCpmk = Array.isArray(d?.cpmk) && (d!.cpmk!.length > 0);
  const dbHasSub = Array.isArray(d?.sub_cpmk) && (d!.sub_cpmk!.length > 0);
  const dbHasDesc = typeof d?.description === "string" && String(d.description).trim().length > 0;
  const effectiveDescription = descLive ?? (dbHasDesc ? String(d!.description) : "");
  const effectiveBahan = bahanKajianLive ?? (dbHasBahan ? d!.bahan_kajian! : []);
  const effectivePustakaUtama = pustakaUtamaLive ?? (dbHasPustaka ? d!.pustaka_utama! : []);
  const effectivePustakaPend = pustakaPendLive ?? (dbHasPustakaPend ? d!.pustaka_pendukung! : []);
  const effectiveCpl = cplLive ?? (dbHasCpl ? d!.cpl! : []);
  const effectiveCpmk = cpmkLive ?? (dbHasCpmk ? d!.cpmk! : []);
  const effectiveSub = subCpmkLive ?? (dbHasSub ? d!.sub_cpmk! : []);
  const saveDesc = useMutation({
    mutationFn: (description: string) => api<{ success: boolean }>(`/api/rps/${id}`, { method: "PUT", body: JSON.stringify({ description }) }),
    onSuccess: () => { setMsg("Deskripsi tersimpan."); qc.invalidateQueries({ queryKey: ["rps", Number(id)] }); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const genDesc = useMutation({
    mutationFn: () => api<{ success: boolean; data: { description: string } }>(`/api/rps/${id}/description/generate`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (r) => { setDescLive(r.data.description); qc.invalidateQueries({ queryKey: ["rps", Number(id)] }); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const saveTemplate = useMutation({
    mutationFn: (payload: { description: string; bahan_kajian: string[]; pustaka_utama: string[]; pustaka_pendukung: string[]; cpl: Cp[]; cpmk: Cp[]; sub_cpmk: Cp[] }) =>
      api<{ success: boolean }>(`/api/rps/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: () => { setMsg("Template tersimpan."); qc.invalidateQueries({ queryKey: ["rps", Number(id)] }); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const fillContoh = () => {
    setDescLive(CONTOH_DESCRIPTION);
    setBahanKajianLive(CONTOH_BAHAN_KAJIAN);
    setPustakaUtamaLive(CONTOH_PUSTAKA_UTAMA);
    setPustakaPendLive(CONTOH_PUSTAKA_PENDUKUNG);
    setCplLive(CONTOH_CPL);
    setCpmkLive(CONTOH_CPMK);
    setSubCpmkLive(CONTOH_SUB_CPMK);
    setMsg("Terisi dari CONTOH 100% (Biomedik Keperawatan — verbatim) — pratinjau update live, klik Simpan template untuk persist.");
  };

  // identitas
  const [identFaculty, setIdentFaculty] = useState(d?.faculty ?? "Fakultas Keperawatan dan Kebidanan");
  const [identProdi, setIdentProdi] = useState(d?.study_program ?? "S1 Ilmu Keperawatan");
  const [identSksT, setIdentSksT] = useState(String(d?.sks_theory ?? 3));
  const [identSksP, setIdentSksP] = useState(String(d?.sks_practice ?? 1));
  const [identSksTotal, setIdentSksTotal] = useState(String(d?.sks_total ?? 4));
  const [identDate, setIdentDate] = useState(d ? isoDate(d.preparation_date) : "2025-06-28");
  useEffect(() => {
    if (!d) return;
    setIdentFaculty(d.faculty ?? "Fakultas Keperawatan dan Kebidanan");
    setIdentProdi(d.study_program ?? "S1 Ilmu Keperawatan");
    setIdentSksT(String(d.sks_theory));
    setIdentSksP(String(d.sks_practice));
    setIdentSksTotal(String(d.sks_total));
    setIdentDate(isoDate(d.preparation_date));
  }, [d?.faculty, d?.study_program, d?.sks_theory, d?.sks_practice, d?.sks_total, d?.preparation_date]);
  const [prodiMeta, setProdiMeta] = useState<Program | null>(null);
  useEffect(() => {
    if (!identProdi) { setProdiMeta(null); return; }
    fetchProgram(identProdi).then((r) => setProdiMeta(r.data)).catch(() => setProdiMeta(null));
  }, [identProdi]);
  const { facultyOptions, prodisForFaculty } = useFaculties();
  const prodiOptions = useMemo(() => prodisForFaculty(identFaculty).map((p) => ({ value: p.value, label: p.label })), [identFaculty, prodisForFaculty]);
  const identSksOk = Number(identSksTotal) === Number(identSksT) + Number(identSksP);
  const saveIdent = useMutation({
    mutationFn: () => api<{ success: boolean }>(`/api/rps/${id}`, {
      method: "PUT", body: JSON.stringify({ faculty: identFaculty, study_program: identProdi, sks_theory: Number(identSksT) || 0, sks_practice: Number(identSksP) || 0, sks_total: Number(identSksTotal) || 0, preparation_date: identDate }),
    }),
    onSuccess: () => { setMsg("Identitas tersimpan."); qc.invalidateQueries({ queryKey: ["rps", Number(id)] }); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const saveWeekly = useMutation({
    mutationFn: (weekly_plans: WeeklyRow[]) => api<{ success: boolean }>(`/api/rps/${id}`, { method: "PUT", body: JSON.stringify({ weekly_plans }) }),
    onSuccess: () => { setMsg("Rencana mingguan tersimpan."); qc.invalidateQueries({ queryKey: ["rps", Number(id)] }); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (q.isLoading) return <div className="text-sm text-secondary">Memuat…</div>;
  if (!d) return <Banner status="error">RPS tidak ditemukan.</Banner>;


  return (
    <div className="grid gap-4">
      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Text weight="semibold">{d.course_name} <span className="font-mono text-xs text-secondary">({d.course_code})</span></Text>
            <Text type="supporting">{d.sks_theory}/{d.sks_practice} SKS · Semester {d.semester} · {d.course_cluster ?? ""}</Text>
            <Text type="supporting">{d.faculty} · {d.study_program}</Text>
          </div>
          <Text type="supporting">{d.lecturers.map((l) => l.name).join(" · ")}</Text>
        </div>
      </Card>

      {msg && <Banner status="success">{msg}</Banner>}
      {err && <Banner status="error">{err}</Banner>}

      {/* Detail — 50/50 split, kanan pratinjau full */}
      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <div className="grid gap-4 min-w-0 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
          <Card>
            <Text weight="semibold">Identitas</Text>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Selector label="Fakultas" value={identFaculty} onChange={(v) => { const prodis = prodisForFaculty(v); setIdentFaculty(v); if (!prodis.some((p) => p.value === identProdi) && prodis[0]) setIdentProdi(prodis[0].value); }} options={facultyOptions} />
                <Selector label="Program studi" value={identProdi} onChange={setIdentProdi} options={prodiOptions.length ? prodiOptions : [{ value: identProdi, label: identProdi }]} />
              </div>
              {prodiMeta?.vision && <Text type="supporting">{prodiMeta.vision}</Text>}
              <Field label="SKS (Teori / Praktik / Total)" inputID="sks-field">
                <div className="flex gap-2">
                  <TextInput label="Teori" isLabelHidden value={identSksT} onChange={setIdentSksT} />
                  <TextInput label="Praktik" isLabelHidden value={identSksP} onChange={setIdentSksP} />
                  <TextInput label="Total" isLabelHidden value={identSksTotal} onChange={setIdentSksTotal} status={!identSksOk ? { type: "error", message: "Harus = Teori + Praktik" } : undefined} />
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Button label="2" variant="secondary" size="sm" onClick={() => { setIdentSksT("1"); setIdentSksP("1"); setIdentSksTotal("2"); }} />
                  <Button label="3" variant="secondary" size="sm" onClick={() => { setIdentSksT("2"); setIdentSksP("1"); setIdentSksTotal("3"); }} />
                  <Button label="4" variant="secondary" size="sm" onClick={() => { setIdentSksT("3"); setIdentSksP("1"); setIdentSksTotal("4"); }} />
                </div>
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <DateInput label="Tanggal penyusunan" value={identDate as ISODateString} onChange={(v) => setIdentDate(v ?? isoDate(new Date().toISOString()))} format="system_date" />
                <div className="flex items-end"><Button label="Hari ini" variant="secondary" size="sm" onClick={() => setIdentDate(isoDate(new Date().toISOString()))} /></div>
              </div>
              <div className="flex gap-2">
                <Button label={saveIdent.isPending ? "Menyimpan…" : "Simpan"} variant="primary" size="sm" isLoading={saveIdent.isPending} isDisabled={!identSksOk} onClick={() => saveIdent.mutate()} />
              </div>
            </div>
          </Card>

          <Card>
            <Text weight="semibold">Deskripsi mata kuliah</Text>
            <textarea
              className="mt-3 min-h-[96px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-primary placeholder:text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              rows={4}
              placeholder="Ringkasan singkat mata kuliah (3–5 baris)."
              value={effectiveDescription}
              onChange={(e) => setDescLive(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button label={genDesc.isPending ? "Memuat…" : "Buat otomatis"} variant="secondary" size="sm" isLoading={genDesc.isPending} onClick={() => genDesc.mutate()} />
              <Button label={saveDesc.isPending ? "Menyimpan…" : "Simpan"} variant="primary" size="sm" isLoading={saveDesc.isPending} onClick={() => saveDesc.mutate(effectiveDescription.trim())} />
              <Button label="Isi CONTOH 100%" variant="secondary" size="sm" onClick={fillContoh} />
            </div>
          </Card>

          <TemplateEditor
            description={effectiveDescription}
            bahanKajian={effectiveBahan}
            pustakaUtama={effectivePustakaUtama}
            pustakaPendukung={effectivePustakaPend}
            cpl={effectiveCpl}
            cpmk={effectiveCpmk}
            subCpmk={effectiveSub}
            onChange={(next) => {
              setDescLive(next.description);
              setBahanKajianLive(next.bahan_kajian);
              setPustakaUtamaLive(next.pustaka_utama);
              setPustakaPendLive(next.pustaka_pendukung);
              setCplLive(next.cpl);
              setCpmkLive(next.cpmk);
              setSubCpmkLive(next.sub_cpmk);
            }}
            onSave={(next) => saveTemplate.mutate(next)}
          />

          <AiGeneratePanel id={Number(id)} />
          <WeeklyTable value={d.weekly_plans} onChange={(rows) => setPreviewRows(rows)} onSave={(rows) => saveWeekly.mutate(rows)} />
        </div>

        <div className="grid gap-3 min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-1rem)] xl:overflow-y-auto">
          <DocxPreview
            id={Number(id)}
            draft={{ ...d, faculty: identFaculty, study_program: identProdi, preparation_date: identDate, description: effectiveDescription, bahan_kajian: effectiveBahan, pustaka_utama: effectivePustakaUtama, pustaka_pendukung: effectivePustakaPend, cpl: effectiveCpl, cpmk: effectiveCpmk, sub_cpmk: effectiveSub }}
            weeklyPlans={effectiveRows}
            description={effectiveDescription}
            bahanKajian={effectiveBahan}
            pustakaUtama={effectivePustakaUtama}
            pustakaPendukung={effectivePustakaPend}
            cpl={effectiveCpl}
            cpmk={effectiveCpmk}
            subCpmk={effectiveSub}
            downloadLabel={`${d.course_code}-${d.course_name}-RPS.docx`.replace(/[^a-zA-Z0-9._-]/g, "_")}
          />
          {!readyToGenerate && effectiveRows.length > 0 && (
            <Banner status="warning">Total bobot harus 100 untuk menghasilkan dokumen yang valid.</Banner>
          )}
        </div>
      </div>
    </div>
  );
}
