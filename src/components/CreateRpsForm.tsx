import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { Card } from "./ui/Card";
import { Field } from "./ui/Field";
import { Stepper } from "./ui/Stepper";
import { Banner } from "./ui/Banner";

type Role = "pengembang"|"koordinator_mk"|"ketua_prodi"|"anggota";

export function CreateRpsForm() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    course_name: "Ilmu Biomedik Dasar",
    course_code: "IW21ASK1541",
    course_cluster: "Keperawatan",
    sks_total: 4, sks_theory: 3, sks_practice: 1,
    semester: "I",
    preparation_date: "2025-06-28",
    lecturers: [
      { name: "Ns. Sri Wahyuni, S.Kep.,M.Kes.", nidn: "001", role: "koordinator_mk" as Role },
      { name: "Ns. Iqwan Syarif, S.Kep.,M.Kep.", nidn: "002", role: "ketua_prodi" as Role },
    ],
    description: "Mata kuliah ini membahas konsep dasar ilmu biomedik untuk keperawatan.",
  });
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => api<{ success:boolean; data:{ id:number } }>("/api/rps", { method:"POST", body: JSON.stringify(form) }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey:["rps"]}); nav({ to:"/rps/$id", params:{ id:String(res.data.id)}}); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  const sksOk = form.sks_total === form.sks_theory + form.sks_practice;
  const hasKoord = form.lecturers.some(l => l.role==="koordinator_mk");

  return (
    <Card>
      <Stepper steps={["Identitas","Deskripsi","Siap Generate"]} current={step} onStep={setStep} />
      {error && <div className="mt-3"><Banner status="error">{error}</Banner></div>}
      {!sksOk && <div className="mt-3"><Banner status="error">SKS total harus = T+P (3+1=4).</Banner></div>}
      {!hasKoord && <div className="mt-3"><Banner status="error">Minimal 1 Koordinator MK.</Banner></div>}

      {step===0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Nama MK"><input className="rounded-lg border px-3 py-2" value={form.course_name} onChange={e=>setForm({...form, course_name:e.target.value})} /></Field>
          <Field label="Kode MK (canonical)" hint="IW21ASK1541 (CONTOH R03)"><input className="rounded-lg border px-3 py-2 font-mono" value={form.course_code} onChange={e=>setForm({...form, course_code:e.target.value})} /></Field>
          <Field label="Rumpun MK"><input className="rounded-lg border px-3 py-2" value={form.course_cluster} onChange={e=>setForm({...form, course_cluster:e.target.value})} /></Field>
          <Field label="Semester"><input className="rounded-lg border px-3 py-2" value={form.semester} onChange={e=>setForm({...form, semester:e.target.value})} /></Field>
          <Field label="SKS Teori (T)"><input type="number" className="rounded-lg border px-3 py-2" value={form.sks_theory} onChange={e=>setForm({...form, sks_theory:Number(e.target.value)})} /></Field>
          <Field label="SKS Praktik (P)"><input type="number" className="rounded-lg border px-3 py-2" value={form.sks_practice} onChange={e=>setForm({...form, sks_practice:Number(e.target.value)})} /></Field>
          <Field label="Total SKS"><input type="number" className="rounded-lg border bg-slate-50 px-3 py-2" value={form.sks_total} onChange={e=>setForm({...form, sks_total:Number(e.target.value)})} /></Field>
          <Field label="Tgl Penyusunan"><input type="date" className="rounded-lg border px-3 py-2" value={form.preparation_date} onChange={e=>setForm({...form, preparation_date:e.target.value})} /></Field>
          <div className="md:col-span-2">
            <div className="text-sm font-medium text-slate-800">Dosen Pengampu (hybrid 4 roles)</div>
            {form.lecturers.map((l,idx)=>(
              <div key={idx} className="mt-2 grid gap-2 md:grid-cols-3">
                <input className="rounded-lg border px-3 py-2" placeholder="Nama" value={l.name} onChange={e=>{ const v=[...form.lecturers]; v[idx]={...v[idx], name:e.target.value}; setForm({...form, lecturers:v});}} />
                <input className="rounded-lg border px-3 py-2" placeholder="NIDN" value={l.nidn} onChange={e=>{ const v=[...form.lecturers]; v[idx]={...v[idx], nidn:e.target.value}; setForm({...form, lecturers:v});}} />
                <select className="rounded-lg border px-3 py-2" value={l.role} onChange={e=>{ const v=[...form.lecturers]; v[idx]={...v[idx], role:e.target.value as Role}; setForm({...form, lecturers:v});}}>
                  <option value="pengembang">Pengembang</option><option value="koordinator_mk">Koordinator MK</option><option value="ketua_prodi">Ketua PRODI</option><option value="anggota">Anggota</option>
                </select>
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <button type="button" className="rounded-full border px-3 py-1 text-sm" onClick={()=>setForm({...form, lecturers:[...form.lecturers, {name:"", nidn:"", role:"anggota"}]})}>+ Dosen</button>
              {form.lecturers.length>1 && <button type="button" className="rounded-full border px-3 py-1 text-sm" onClick={()=>setForm({...form, lecturers: form.lecturers.slice(0,-1)})}>− Hapus</button>}
            </div>
          </div>
        </div>
      )}
      {step===1 && (
        <div className="mt-4 grid gap-3">
          <Field label="Deskripsi MK"><textarea className="min-h-[120px] rounded-lg border px-3 py-2" value={form.description} onChange={e=>setForm({...form, description:e.target.value})} /></Field>
          <div className="text-xs text-slate-500">Kop hardcode: Universitas Megarezky | Fakultas Keperawatan dan Kebidanan | S1 Keperawatan dan Profesi Ners</div>
          <div className="text-xs text-slate-500">Default 5 dosen contoh tersedia di seed; edit di Step 1 bila perlu.</div>
        </div>
      )}
      {step===2 && (
        <div className="mt-4 rounded-lg border bg-slate-50 p-4 text-sm text-slate-700">
          <div className="font-medium">Siap generate AI</div>
          <div className="mt-1">Setelah Buat Draft, buka detail → pilih provider (OpenAI/Gemini) → Generate 9 baris (16 minggu) → weight 100 → Generate DOCX.</div>
        </div>
      )}
      <div className="mt-4 flex justify-between">
        <button type="button" className="rounded-full border px-4 py-2 text-sm" disabled={step===0} onClick={()=>setStep(step-1)}>Kembali</button>
        {step<2 ? <button type="button" className="rounded-full bg-[#1E3A5F] px-5 py-2 text-sm font-medium text-white" onClick={()=>setStep(step+1)}>Lanjut</button>
        : <button type="button" disabled={m.isPending || !sksOk || !hasKoord} className="rounded-full bg-[#1E3A5F] px-5 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={()=>m.mutate()}>{m.isPending ? "Menyimpan…" : "Buat Draft"}</button>}
      </div>
    </Card>
  );
}
