import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiOk } from "@/lib/api";
import { WeeklyTable, type WeeklyRow } from "@/components/WeeklyTable";
import { AiGeneratePanel } from "@/components/AiGeneratePanel";
import { Card } from "@/components/ui/Card";
import { Banner } from "@/components/ui/Banner";
import { useState } from "react";

type Detail = { id:number; course_name:string; course_code:string; course_cluster:string|null; sks_total:number; sks_theory:number; sks_practice:number; semester:string; preparation_date:string; lecturers:{name:string;nidn:string;role:string}[]; weekly_plans: WeeklyRow[]; status:string; file_hash:string|null; ai_provider:string|null; ai_model:string|null };

export const Route = createFileRoute("/rps/$id")({
  component: RpsDetail,
});

function RpsDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [msg,setMsg]=useState<string|null>(null); const [err,setErr]=useState<string|null>(null);
  const q = useQuery({ queryKey:["rps", Number(id)], queryFn: ()=> api<ApiOk<Detail>>(`/api/rps/${id}`) });
  const d = q.data?.data;

  const saveWeekly = useMutation({
    mutationFn: (weekly_plans: WeeklyRow[])=> api<{ success:boolean; data:{ weight_total:number } }>(`/api/rps/${id}`, { method:"PUT", body: JSON.stringify({ weekly_plans }) }),
    onSuccess: ()=>{ setMsg("Tersimpan"); qc.invalidateQueries({queryKey:["rps", Number(id)]}); },
    onError:(e:unknown)=> setErr(e instanceof Error ? e.message : String(e)),
  });
  const gen = useMutation({
    mutationFn: ()=> api<{ success:boolean; data:{ docx_url:string; file_hash:string } }>(`/api/rps/${id}/generate`, { method:"POST" }),
    onSuccess:(r)=>{ setMsg(`DOCX siap: ${r.data.file_hash}`); qc.invalidateQueries({queryKey:["rps", Number(id)]}); },
    onError:(e:unknown)=> setErr(e instanceof Error ? e.message : String(e)),
  });
  const audit = useMutation({
    mutationFn: ()=> api<{ success:boolean; data:{ passed:boolean; issues:{ code:string; severity:string; message:string }[] } }>(`/api/rps/${id}/audit`, { method:"POST" }),
    onSuccess:(r)=> setMsg(r.data.passed ? "Audit passed" : `Audit: ${r.data.issues.map(i=>i.message).join("; ")}`),
    onError:(e:unknown)=> setErr(e instanceof Error ? e.message : String(e)),
  });

  if (q.isLoading) return <div className="text-sm text-slate-500">Memuat…</div>;
  if (!d) return <Banner status="error">Not found</Banner>;

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex items-center justify-between">
          <div><div className="font-semibold text-slate-900">{d.course_name} <span className="font-mono text-xs text-slate-500">({d.course_code})</span></div><div className="text-xs text-slate-500">SKS {d.sks_theory}/{d.sks_practice} total {d.sks_total} · Semester {d.semester} · {new Date(d.preparation_date).toLocaleDateString("id-ID")}</div></div>
          <span className={`rounded-full border px-2 py-1 text-xs ${d.status==="generated" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50"}`}>{d.status}{d.file_hash ? ` · ${d.file_hash.slice(0,8)}`:""}</span>
        </div>
        <div className="mt-2 text-xs text-slate-600">Dosen: {d.lecturers.map(l=>`${l.name} (${l.role})`).join(" · ")}</div>
      </Card>

      <AiGeneratePanel id={Number(id)} />
      <WeeklyTable value={d.weekly_plans} onSave={(rows)=>saveWeekly.mutate(rows)} />

      {msg && <Banner status="success">{msg}</Banner>}
      {err && <Banner status="error">{err}</Banner>}

      <Card>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-full border px-4 py-2 text-sm" onClick={()=>audit.mutate()} disabled={audit.isPending}>{audit.isPending ? "Audit…" : "Audit"}</button>
          <button className="rounded-full bg-[#1E3A5F] px-5 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={()=>gen.mutate()} disabled={gen.isPending}>{gen.isPending ? "Generate DOCX…" : "Generate DOCX"}</button>
          {d.file_hash && <a className="rounded-full border border-[#1E3A5F] px-5 py-2 text-sm text-[#1E3A5F]" href={`/api/rps/${id}/download`}>Download DOCX</a>}
        </div>
        <div className="mt-2 text-xs text-slate-500">Python docx service plumbing — jika belum jalan, endpoint akan stub hash dan status generated.</div>
      </Card>
    </div>
  );
}
