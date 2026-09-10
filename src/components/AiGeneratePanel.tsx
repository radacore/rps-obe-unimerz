import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card } from "./ui/Card";
import { Banner } from "./ui/Banner";
import { Field } from "./ui/Field";
export function AiGeneratePanel({ id }: { id: number }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<"openai"|"gemini">("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [msg, setMsg] = useState<string|null>(null);
  const [err, setErr] = useState<string|null>(null);
  const m = useMutation({
    mutationFn: () => api<{ success:boolean; data: unknown; message?:string }>(`/api/rps/${id}/ai/generate`, { method:"POST", body: JSON.stringify({ provider, model }) }),
    onSuccess: (r) => { setMsg(r.message ?? "AI generated"); setErr(null); qc.invalidateQueries({queryKey:["rps",id]}); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });
  return (
    <Card>
      <div className="font-medium text-slate-900">Generate AI — 9 baris mewakili 16 minggu</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label="Provider"><select className="rounded-lg border px-3 py-2" value={provider} onChange={e=>{ const v=e.target.value as never; setProvider(v); setModel(v==="openai"?"gpt-4o-mini":"gemini-1.5-flash");}}><option value="openai">OpenAI (sk-...)</option><option value="gemini">Gemini (AIza...)</option></select></Field>
        <Field label="Model"><select className="rounded-lg border px-3 py-2" value={model} onChange={e=>setModel(e.target.value)}>
          {provider==="openai" ? <><option value="gpt-4o-mini">gpt-4o-mini</option><option value="gpt-4o">gpt-4o</option></> : <><option value="gemini-1.5-flash">gemini-1.5-flash</option><option value="gemini-1.5-pro">gemini-1.5-pro</option></>}
        </select></Field>
      </div>
      <div className="mt-3 flex gap-2">
        <button className="rounded-full bg-[#1E3A5F] px-5 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={m.isPending} onClick={()=>m.mutate()}>{m.isPending ? "Generating…" : "Generate 9 baris (16 minggu)"}</button>
        <a href="/settings" className="rounded-full border px-4 py-2 text-sm">Atur API Key</a>
      </div>
      {msg && <div className="mt-3"><Banner status="success">{msg}</Banner></div>}
      {err && <div className="mt-3"><Banner status="error">{err}</Banner></div>}
      <div className="mt-3 text-xs text-slate-500">Rule: weight non-merge 100 (R35 5, R36 5, R37 10, R38 20, R40 30, R41 10, R42 20) + is_merged UTS (8) & UAS (16) = 0. Hooks: pandemic, Daring/Luring, kop Megarezky.</div>
    </Card>
  );
}
