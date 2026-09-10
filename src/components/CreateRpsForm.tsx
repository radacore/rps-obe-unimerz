import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { Card } from "./ui/Card";
import { Banner } from "./ui/Banner";
import { Stepper } from "./ui/Stepper";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { Field } from "@astryxdesign/core/Field";

type Role = "pengembang" | "koordinator_mk" | "ketua_prodi" | "anggota";

const CONTOH = {
  course_name: "Ilmu Biomedik Dasar",
  course_code: "IW21ASK1541",
  course_cluster: "Keperawatan",
  sks_total: 4,
  sks_theory: 3,
  sks_practice: 1,
  semester: "I",
  preparation_date: "2025-06-28",
  lecturers: [
    { name: "Ns. Sri Wahyuni, S.Kep.,M.Kes.", nidn: "0901018201", role: "koordinator_mk" as Role },
    { name: "Ns. Iqwan Syarif, S.Kep.,M.Kep.", nidn: "001", role: "ketua_prodi" as Role },
    { name: "Ns. Dewi Sartika, S.Kep.,M.Kep.", nidn: "003", role: "pengembang" as Role },
  ],
  description: "Mata kuliah Ilmu Biomedik Dasar membahas konsep sel, genetika, biomekanika, biokimia, dan anatomi dasar untuk landasan asuhan keperawatan.",
} satisfies Record<string, unknown>;

const ROLE_OPTIONS = [
  { value: "pengembang", label: "Pengembang" },
  { value: "koordinator_mk", label: "Koordinator MK" },
  { value: "ketua_prodi", label: "Ketua PRODI" },
  { value: "anggota", label: "Anggota" },
];

export function CreateRpsForm() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    course_name: CONTOH.course_name,
    course_code: CONTOH.course_code,
    course_cluster: CONTOH.course_cluster,
    sks_total: CONTOH.sks_total,
    sks_theory: CONTOH.sks_theory,
    sks_practice: CONTOH.sks_practice,
    semester: CONTOH.semester,
    preparation_date: CONTOH.preparation_date,
    lecturers: [...CONTOH.lecturers],
    description: CONTOH.description,
  });
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const sksOk = useMemo(() => form.sks_total === form.sks_theory + form.sks_practice, [form.sks_total, form.sks_theory, form.sks_practice]);
  const hasKoord = useMemo(() => form.lecturers.some((l) => l.role === "koordinator_mk"), [form.lecturers]);
  const nameOk = form.course_name.trim().length >= 2;
  const codeOk = form.course_code.trim().length >= 2;
  const canSubmit = sksOk && hasKoord && nameOk && codeOk;

  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(() => {
      if (!sksOk) setHint("SKS total harus = T + P — contoh 3 + 1 = 4");
      else if (!hasKoord) setHint("Pilih minimal 1 Koordinator MK — wajib untuk Otorisasi R04");
      else if (!nameOk || !codeOk) setHint("Nama & kode MK minimal 2 karakter");
      else setHint(null);
    }, 300);
    return () => clearTimeout(t);
  }, [touched, sksOk, hasKoord, nameOk, codeOk]);

  const m = useMutation({
    mutationFn: () => api<{ success: boolean; data: { id: number } }>("/api/rps", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["rps"] });
      nav({ to: "/rps/$id", params: { id: String(res.data.id) } });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  const fillContoh = () => {
    setForm({
      course_name: String(CONTOH.course_name),
      course_code: String(CONTOH.course_code),
      course_cluster: String(CONTOH.course_cluster),
      sks_total: Number(CONTOH.sks_total),
      sks_theory: Number(CONTOH.sks_theory),
      sks_practice: Number(CONTOH.sks_practice),
      semester: String(CONTOH.semester),
      preparation_date: String(CONTOH.preparation_date),
      lecturers: [...CONTOH.lecturers] as typeof form.lecturers,
      description: String(CONTOH.description),
    });
    setTouched(true);
    setError(null);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stepper steps={["Identitas", "Deskripsi", "Siap Generate"]} current={step} onStep={setStep} />
        <Button label="Isi contoh CONTOH" variant="secondary" size="sm" onClick={fillContoh} />
      </div>

      {error && <div className="mt-3"><Banner status="error">{error}</Banner></div>}
      {hint && <div className="mt-3"><Banner status={sksOk && hasKoord ? "warning" : "error"}>{hint}</Banner></div>}
      {!sksOk && touched && <div className="mt-3"><Banner status="error">SKS total harus = T+P (mis. 3+1=4).</Banner></div>}
      {!hasKoord && touched && <div className="mt-3"><Banner status="error">Minimal 1 Koordinator MK — mapping Otorisasi R04.</Banner></div>}

      {step === 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <TextInput label="Nama MK" value={form.course_name} onChange={(v) => { setTouched(true); setForm({ ...form, course_name: v }); }} placeholder="Ilmu Biomedik Dasar" status={!nameOk && touched ? { type: "error", message: "Min 2 karakter" } : undefined} />
          <TextInput label="Kode MK (canonical)" value={form.course_code} onChange={(v) => { setTouched(true); setForm({ ...form, course_code: v }); }} placeholder="IW21ASK1541" description="Sync cover (IW21ASK1541) R03" status={!codeOk && touched ? { type: "error", message: "Min 2 karakter" } : undefined} />
          <TextInput label="Rumpun MK" value={form.course_cluster} onChange={(v) => setForm({ ...form, course_cluster: v })} placeholder="Keperawatan" />
          <TextInput label="Semester" value={form.semester} onChange={(v) => setForm({ ...form, semester: v })} placeholder="I" description="I–VIII, Ganjil/Genap" />
          <TextInput label="SKS Teori (T)" value={String(form.sks_theory)} onChange={(v) => { setTouched(true); setForm({ ...form, sks_theory: Number(v) }); }} />
          <TextInput label="SKS Praktik (P)" value={String(form.sks_practice)} onChange={(v) => { setTouched(true); setForm({ ...form, sks_practice: Number(v) }); }} />
          <TextInput label="Total SKS" value={String(form.sks_total)} onChange={(v) => { setTouched(true); setForm({ ...form, sks_total: Number(v) }); }} description={sksOk ? "✓ T+P" : "Harus = T + P"} status={!sksOk && touched ? { type: "error", message: "Harus = T+P" } : undefined} />
          <TextInput label="Tgl Penyusunan" value={form.preparation_date} onChange={(v) => setForm({ ...form, preparation_date: v })} />
          <div className="md:col-span-2">
            <Field label="Dosen Pengampu (hybrid 4 roles)" inputID="lecturers-field" description="R04 Otorisasi 3 slot + R29 Dosen Pengampu — minimal 1 Koordinator MK.">
              <div className="grid gap-2">
                {form.lecturers.map((l, idx) => (
                  <div key={idx} className="grid gap-2 md:grid-cols-3">
                    <TextInput label="Nama" isLabelHidden value={l.name} onChange={(v) => { const vv = [...form.lecturers]; vv[idx] = { ...vv[idx], name: v }; setForm({ ...form, lecturers: vv }); setTouched(true); }} placeholder="Nama (contoh: Ns. Sri Wahyuni, S.Kep.,M.Kes.)" />
                    <TextInput label="NIDN" isLabelHidden value={l.nidn} onChange={(v) => { const vv = [...form.lecturers]; vv[idx] = { ...vv[idx], nidn: v }; setForm({ ...form, lecturers: vv }); }} placeholder="NIDN" />
                    <Selector label="Role" isLabelHidden value={l.role} onChange={(v) => { const vv = [...form.lecturers]; vv[idx] = { ...vv[idx], role: v as Role }; setForm({ ...form, lecturers: vv }); setTouched(true); }} options={ROLE_OPTIONS} />
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button label="+ Dosen" variant="secondary" size="sm" onClick={() => setForm({ ...form, lecturers: [...form.lecturers, { name: "", nidn: "", role: "anggota" }] })} />
                  {form.lecturers.length > 1 && <Button label="− Hapus" variant="ghost" size="sm" onClick={() => setForm({ ...form, lecturers: form.lecturers.slice(0, -1) })} />}
                  <span className="text-xs text-secondary">{form.lecturers.length} dosen · kop hardcode Megarezky</span>
                </div>
              </div>
            </Field>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="mt-4 grid gap-3">
          <TextArea label="Deskripsi MK (bahan kajian singkat)" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Contoh: HTML, CSS, REST API, Vercel…" rows={5} description="3–5 baris — dipakai prompt AI" />
          <Banner status="info" title="Kop hardcode">Universitas Megarezky | Fakultas Keperawatan dan Kebidanan | S1 Keperawatan dan Profesi Ners — Default 5 dosen contoh tersedia di seed.</Banner>
        </div>
      )}
      {step === 2 && (
        <div className="mt-4">
          <Banner status="info" title="Siap generate AI">
            <span className="leading-relaxed">Setelah <strong>Buat Draft</strong>, buka detail → pilih provider (OpenAI/Gemini) di Generate AI → Generate 9 baris (16 minggu) berat 5/5/10/20/30/10/20 Σ100 + UTS/UAS merge → edit tabel 8 kolom bila perlu → <strong>Audit → Generate DOCX → Download</strong>. Total demo ~2 menit.</span>
          </Banner>
        </div>
      )}
      <div className="mt-4 flex justify-between">
        <Button label="Kembali" variant="secondary" isDisabled={step === 0} onClick={() => setStep(step - 1)} />
        {step < 2 ? (
          <Button label="Lanjut" variant="primary" onClick={() => { setTouched(true); setStep(step + 1); }} />
        ) : (
          <Button label={m.isPending ? "Menyimpan…" : "Buat Draft"} variant="primary" isDisabled={m.isPending || !canSubmit} isLoading={m.isPending} tooltip={!canSubmit ? (!sksOk ? "SKS total harus = T+P" : !hasKoord ? "Butuh Koordinator MK" : "Lengkapi nama/kode") : undefined} onClick={() => { setTouched(true); m.mutate(); }} />
        )}
      </div>
      <div className="mt-2 text-xs text-secondary">Demo cepat: klik Isi contoh CONTOH → Lanjut → Lanjut → Buat Draft.</div>
    </Card>
  );
}
