import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { Card } from "./ui/Card";
import { Field } from "./ui/Field";
import { Stepper } from "./ui/Stepper";
import { Banner } from "./ui/Banner";

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

  // debounced hint for demo
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
      <div className="flex items-center justify-between gap-3">
        <Stepper steps={["Identitas", "Deskripsi", "Siap Generate"]} current={step} onStep={setStep} />
        <button type="button" className="rounded-full border px-3 py-1 text-xs hover:bg-slate-50" onClick={fillContoh} title="Isi otomatis contoh CONTOH RPS.docx">
          Isi contoh CONTOH
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <Banner status="error">{error}</Banner>
        </div>
      )}
      {hint && (
        <div className="mt-3">
          <Banner status={sksOk && hasKoord ? "warning" : "error"}>{hint}</Banner>
        </div>
      )}
      {!sksOk && touched && (
        <div className="mt-3">
          <Banner status="error">SKS total harus = T+P (mis. 3+1=4).</Banner>
        </div>
      )}
      {!hasKoord && touched && (
        <div className="mt-3">
          <Banner status="error">Minimal 1 Koordinator MK — mapping Otorisasi R04.</Banner>
        </div>
      )}

      {step === 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Nama MK" hint={nameOk ? undefined : "Min 2 karakter"}>
            <input
              className="rounded-lg border px-3 py-2 focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
              value={form.course_name}
              onChange={(e) => {
                setTouched(true);
                setForm({ ...form, course_name: e.target.value });
              }}
              placeholder="Ilmu Biomedik Dasar"
            />
          </Field>
          <Field label="Kode MK (canonical)" hint="IW21ASK1541 — sync cover (IW21ASK1541) R03">
            <input
              className="rounded-lg border px-3 py-2 font-mono focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
              value={form.course_code}
              onChange={(e) => {
                setTouched(true);
                setForm({ ...form, course_code: e.target.value });
              }}
              placeholder="IW21ASK1541"
            />
          </Field>
          <Field label="Rumpun MK">
            <input
              className="rounded-lg border px-3 py-2 focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
              value={form.course_cluster}
              onChange={(e) => setForm({ ...form, course_cluster: e.target.value })}
              placeholder="Keperawatan"
            />
          </Field>
          <Field label="Semester" hint="I–VIII, Ganjil/Genap">
            <input
              className="rounded-lg border px-3 py-2"
              value={form.semester}
              onChange={(e) => setForm({ ...form, semester: e.target.value })}
              placeholder="I"
            />
          </Field>
          <Field label="SKS Teori (T)">
            <input
              type="number"
              className="rounded-lg border px-3 py-2"
              value={form.sks_theory}
              onChange={(e) => {
                setTouched(true);
                setForm({ ...form, sks_theory: Number(e.target.value) });
              }}
              min={0}
              max={12}
            />
          </Field>
          <Field label="SKS Praktik (P)">
            <input
              type="number"
              className="rounded-lg border px-3 py-2"
              value={form.sks_practice}
              onChange={(e) => {
                setTouched(true);
                setForm({ ...form, sks_practice: Number(e.target.value) });
              }}
              min={0}
              max={12}
            />
          </Field>
          <Field label="Total SKS" hint={sksOk ? "✓ T+P" : "Harus = T + P"}>
            <input
              type="number"
              className={`rounded-lg border px-3 py-2 ${sksOk ? "bg-slate-50" : "border-red-300 bg-red-50"}`}
              value={form.sks_total}
              onChange={(e) => {
                setTouched(true);
                setForm({ ...form, sks_total: Number(e.target.value) });
              }}
              min={1}
              max={12}
            />
          </Field>
          <Field label="Tgl Penyusunan">
            <input
              type="date"
              className="rounded-lg border px-3 py-2"
              value={form.preparation_date}
              onChange={(e) => setForm({ ...form, preparation_date: e.target.value })}
            />
          </Field>
          <div className="md:col-span-2">
            <div className="text-sm font-medium text-slate-800">Dosen Pengampu (hybrid 4 roles)</div>
            <div className="text-xs text-slate-500">R04 Otorisasi 3 slot + R29 Dosen Pengampu — minimal 1 Koordinator MK.</div>
            {form.lecturers.map((l, idx) => (
              <div key={idx} className="mt-2 grid gap-2 md:grid-cols-3">
                <input
                  className="rounded-lg border px-3 py-2"
                  placeholder="Nama (contoh: Ns. Sri Wahyuni, S.Kep.,M.Kes.)"
                  value={l.name}
                  onChange={(e) => {
                    const v = [...form.lecturers];
                    v[idx] = { ...v[idx], name: e.target.value };
                    setForm({ ...form, lecturers: v });
                    setTouched(true);
                  }}
                />
                <input
                  className="rounded-lg border px-3 py-2"
                  placeholder="NIDN"
                  value={l.nidn}
                  onChange={(e) => {
                    const v = [...form.lecturers];
                    v[idx] = { ...v[idx], nidn: e.target.value };
                    setForm({ ...form, lecturers: v });
                  }}
                />
                <select
                  className="rounded-lg border px-3 py-2"
                  value={l.role}
                  onChange={(e) => {
                    const v = [...form.lecturers];
                    v[idx] = { ...v[idx], role: e.target.value as Role };
                    setForm({ ...form, lecturers: v });
                    setTouched(true);
                  }}
                >
                  <option value="pengembang">Pengembang</option>
                  <option value="koordinator_mk">Koordinator MK</option>
                  <option value="ketua_prodi">Ketua PRODI</option>
                  <option value="anggota">Anggota</option>
                </select>
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-full border px-3 py-1 text-sm hover:bg-slate-50"
                onClick={() => setForm({ ...form, lecturers: [...form.lecturers, { name: "", nidn: "", role: "anggota" }] })}
              >
                + Dosen
              </button>
              {form.lecturers.length > 1 && (
                <button
                  type="button"
                  className="rounded-full border px-3 py-1 text-sm hover:bg-slate-50"
                  onClick={() => setForm({ ...form, lecturers: form.lecturers.slice(0, -1) })}
                >
                  − Hapus
                </button>
              )}
              <span className="py-1 text-xs text-slate-400">{form.lecturers.length} dosen · kop hardcode Megarezky</span>
            </div>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="mt-4 grid gap-3">
          <Field label="Deskripsi MK (bahan kajian singkat)" hint="3–5 baris — dipakai prompt AI">
            <textarea
              className="min-h-[120px] rounded-lg border px-3 py-2 focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Contoh: HTML, CSS, REST API, Vercel…"
            />
          </Field>
          <div className="rounded-lg border border-dashed bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            Kop hardcode: <span className="font-medium">Universitas Megarezky | Fakultas Keperawatan dan Kebidanan | S1 Keperawatan dan Profesi Ners</span>
            <br />
            Default 5 dosen contoh tersedia di seed; edit di Step 1 bila perlu. File `CONTOH RPS.docx` jadi acuan fidelity DOCX.
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="mt-4 rounded-lg border bg-slate-50 p-4 text-sm text-slate-700">
          <div className="font-medium">Siap generate AI</div>
          <div className="mt-1 leading-relaxed">
            Setelah <span className="font-medium">Buat Draft</span>, buka detail → pilih provider (OpenAI/Gemini) di <span className="font-mono">Generate AI</span> → Generate 9 baris (16 minggu) berat 5/5/10/20/30/10/20 Σ100 + UTS/UAS merge → edit tabel 8 kolom bila perlu →{" "}
            <span className="font-medium">Audit → Generate DOCX → Download</span>. Total demo ~2 menit.
          </div>
          <div className="mt-2 text-xs text-slate-500">Hint: atur API Key di Settings dulu bila key belum ada — BYOK sk-… / AIza…</div>
        </div>
      )}
      <div className="mt-4 flex justify-between">
        <button
          type="button"
          className="rounded-full border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          Kembali
        </button>
        {step < 2 ? (
          <button
            type="button"
            className="rounded-full bg-[#1E3A5F] px-5 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
            onClick={() => {
              setTouched(true);
              setStep(step + 1);
            }}
          >
            Lanjut
          </button>
        ) : (
          <button
            type="button"
            disabled={m.isPending || !canSubmit}
            title={!canSubmit ? (!sksOk ? "SKS total harus = T+P" : !hasKoord ? "Butuh Koordinator MK" : "Lengkapi nama/kode") : "Buat draft dan buka detail"}
            className="rounded-full bg-[#1E3A5F] px-5 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
            onClick={() => {
              setTouched(true);
              m.mutate();
            }}
          >
            {m.isPending ? "Menyimpan…" : "Buat Draft"}
          </button>
        )}
      </div>
      <div className="mt-2 text-xs text-slate-400">Demo cepat: klik Isi contoh CONTOH → Lanjut → Lanjut → Buat Draft.</div>
    </Card>
  );
}
