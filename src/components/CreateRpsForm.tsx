import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { fetchProgram } from "@/lib/programs";
import { useFaculties } from "@/lib/useFaculties";
import { Card } from "./ui/Card";
import { Banner } from "./ui/Banner";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Field } from "@astryxdesign/core/Field";

type Role = "pengembang" | "koordinator_mk" | "ketua_prodi" | "anggota";

const ROLE_OPTIONS = [
  { value: "pengembang", label: "Pengembang" },
  { value: "koordinator_mk", label: "Koordinator MK" },
  { value: "ketua_prodi", label: "Ketua PRODI" },
  { value: "anggota", label: "Anggota" },
];

// placeholder contoh — S1 Ilmu Komputer (hanya hint, bukan nilai awal)
const PH = {
  course_name: "Algoritma dan Struktur Data",
  course_code: "IK24IK1201",
  course_cluster: "Ilmu Komputer",
  semester: "III",
  lecturer_name: "Dr. Andi Pratama, S.Kom., M.Kom.",
  lecturer_nidn: "0922038401",
  description: "Mata kuliah ini membahas konsep algoritma, struktur data linier dan non-linier, analisis kompleksitas, serta implementasi dalam bahasa pemrograman untuk fondasi pengembangan perangkat lunak.",
} as const;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function CreateRpsForm() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [form, setForm] = useState({
    course_name: "",
    course_code: "",
    course_cluster: "",
    faculty: "Fakultas Ilmu Komputer" as string,
    study_program: "S1 Ilmu Komputer" as string,
    sks_total: 3 as number,
    sks_theory: 2 as number,
    sks_practice: 1 as number,
    semester: "",
    preparation_date: todayISO(),
    lecturers: [{ name: "", nidn: "", role: "koordinator_mk" as Role }],
    description: "" as string,
  });
  const [error, setError] = useState<string | null>(null);
  const [prodiMeta, setProdiMeta] = useState<null | import("@/lib/programs").Program>(null);
  useEffect(() => {
    const slug = form.study_program;
    if (!slug) { setProdiMeta(null); return; }
    fetchProgram(slug).then((r) => setProdiMeta(r.data)).catch(() => setProdiMeta(null));
  }, [form.study_program]);

  const { facultyOptions, prodisForFaculty } = useFaculties();
  const prodiOptions = useMemo(() => prodisForFaculty(form.faculty).map((p) => ({ value: p.value, label: p.label })), [form.faculty, prodisForFaculty]);
  const sksOk = form.sks_total === form.sks_theory + form.sks_practice;
  const hasKoord = form.lecturers.some((l) => l.role === "koordinator_mk");
  const canSubmit = sksOk && hasKoord && form.course_name.trim().length >= 2 && form.course_code.trim().length >= 2;

  const genDesc = useMutation({
    mutationFn: () => api<{ success: boolean; data: { description: string } }>("/api/description/generate", {
      method: "POST",
      body: JSON.stringify({ course_name: form.course_name || PH.course_name, course_code: form.course_code || PH.course_code, semester: form.semester || PH.semester, sks_total: form.sks_total }),
    }),
    onSuccess: (res) => setForm((prev) => ({ ...prev, description: res.data.description })),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  const m = useMutation({
    mutationFn: () => api<{ success: boolean; data: { id: number } }>("/api/rps", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["rps"] });
      nav({ to: "/rps/$id", params: { id: String(res.data.id) } });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  const setFaculty = (v: string) => {
    const prodis = prodisForFaculty(v);
    const nextProdi = prodis[0]?.value ?? form.study_program;
    setForm((prev) => ({ ...prev, faculty: v, study_program: nextProdi }));
  };

  return (
    <div className="grid gap-4">
      <Card>
        <div>
          <Text weight="semibold">Buat RPS Baru</Text>
          <Text type="supporting">Lengkapi identitas, lalu buat draft untuk diisi dengan AI.</Text>
        </div>
        {error && <div className="mt-3"><Banner status="error">{error}</Banner></div>}

        <div className="mt-4 grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <TextInput label="Nama mata kuliah" value={form.course_name} onChange={(v) => setForm({ ...form, course_name: v })} placeholder={PH.course_name} />
            <TextInput label="Kode mata kuliah" value={form.course_code} onChange={(v) => setForm({ ...form, course_code: v })} placeholder={PH.course_code} />
            <Selector label="Fakultas" value={form.faculty} onChange={setFaculty} options={facultyOptions} />
            <Selector label="Program studi" value={form.study_program} onChange={(v) => setForm({ ...form, study_program: v })} options={prodiOptions.length ? prodiOptions : [{ value: form.study_program, label: form.study_program }]} />
          </div>

          {prodiMeta && (
            <div className="rounded-lg border border-border bg-muted px-3 py-2">
              <Text weight="semibold">{prodiMeta.label} — {prodiMeta.faculty_label}</Text>
              {prodiMeta.vision && <Text type="supporting">{prodiMeta.vision}</Text>}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <TextInput label="Rumpun mata kuliah" value={form.course_cluster} onChange={(v) => setForm({ ...form, course_cluster: v })} placeholder={PH.course_cluster} />
            <TextInput label="Semester" value={form.semester} onChange={(v) => setForm({ ...form, semester: v })} placeholder={PH.semester} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid grid-cols-3 gap-2">
              <TextInput label="SKS Teori" value={String(form.sks_theory)} onChange={(v) => setForm({ ...form, sks_theory: Number(v) || 0 })} />
              <TextInput label="SKS Praktik" value={String(form.sks_practice)} onChange={(v) => setForm({ ...form, sks_practice: Number(v) || 0 })} />
              <TextInput label="Total SKS" value={String(form.sks_total)} onChange={(v) => setForm({ ...form, sks_total: Number(v) || 0 })} status={!sksOk ? { type: "error", message: "Harus = Teori + Praktik" } : undefined} />
            </div>
            <div className="flex flex-wrap items-end gap-1.5">
              <Button label="2 SKS" variant="secondary" size="sm" onClick={() => setForm({ ...form, sks_theory: 1, sks_practice: 1, sks_total: 2 })} />
              <Button label="3 SKS" variant="secondary" size="sm" onClick={() => setForm({ ...form, sks_theory: 2, sks_practice: 1, sks_total: 3 })} />
              <Button label="4 SKS" variant="secondary" size="sm" onClick={() => setForm({ ...form, sks_theory: 3, sks_practice: 1, sks_total: 4 })} />
            </div>
          </div>
          {!sksOk && <Banner status="error">Total SKS harus sama dengan Teori + Praktik.</Banner>}

          <div className="grid gap-3 md:grid-cols-2">
            <DateInput label="Tanggal penyusunan" value={form.preparation_date as import("@astryxdesign/core/Calendar").ISODateString} onChange={(v) => setForm({ ...form, preparation_date: v ?? todayISO() })} format="system_date" />
            <div className="flex items-end">
              <Button label="Hari ini" variant="secondary" size="sm" onClick={() => setForm({ ...form, preparation_date: todayISO() })} />
            </div>
          </div>

          <Field label="Dosen pengampu" inputID="lecturers-field" description="Minimal satu Koordinator MK.">
            <div className="grid gap-2">
              {form.lecturers.map((l, idx) => (
                <div key={idx} className="grid gap-2 md:grid-cols-3">
                  <TextInput label="Nama" isLabelHidden value={l.name} onChange={(v) => { const vv = [...form.lecturers]; vv[idx] = { ...vv[idx], name: v }; setForm({ ...form, lecturers: vv }); }} placeholder={PH.lecturer_name} />
                  <TextInput label="NIDN" isLabelHidden value={l.nidn} onChange={(v) => { const vv = [...form.lecturers]; vv[idx] = { ...vv[idx], nidn: v }; setForm({ ...form, lecturers: vv }); }} placeholder={PH.lecturer_nidn} />
                  <Selector label="Peran" isLabelHidden value={l.role} onChange={(v) => { const vv = [...form.lecturers]; vv[idx] = { ...vv[idx], role: v as Role }; setForm({ ...form, lecturers: vv }); }} options={ROLE_OPTIONS} />
                </div>
              ))}
              <div className="flex gap-2">
                <Button label="+ Tambah" variant="secondary" size="sm" onClick={() => setForm({ ...form, lecturers: [...form.lecturers, { name: "", nidn: "", role: "anggota" }] })} />
                {form.lecturers.length > 1 && <Button label="Hapus" variant="ghost" size="sm" onClick={() => setForm({ ...form, lecturers: form.lecturers.slice(0, -1) })} />}
              </div>
            </div>
          </Field>
          {!hasKoord && <Banner status="error">Pilih minimal satu Koordinator MK.</Banner>}

          <div className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-secondary">
            Pratinjau kop: <strong className="text-primary">Universitas Megarezky | {form.faculty} | {form.study_program}</strong> — SKS {form.sks_theory}/{form.sks_practice} · {form.preparation_date}
          </div>

          <div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <TextArea label="Deskripsi mata kuliah" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder={PH.description} rows={4} />
              </div>
              <Button label={genDesc.isPending ? "Memuat…" : "Buat otomatis"} variant="secondary" size="sm" isLoading={genDesc.isPending} onClick={() => genDesc.mutate()} />
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button label={m.isPending ? "Menyimpan…" : "Buat RPS"} variant="primary" isLoading={m.isPending} isDisabled={!canSubmit} onClick={() => m.mutate()} />
        </div>
      </Card>
    </div>
  );
}
