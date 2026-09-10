import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiOk } from "@/lib/api";
import { useState } from "react";
import { Card } from "./ui/Card";
import { Field } from "./ui/Field";
import { Banner } from "./ui/Banner";
import { Badge } from "./ui/Badge";
export function SettingsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey:["api-keys"], queryFn: ()=> api<ApiOk<{ provider:string; keyHint:string|null; isActive:boolean }[]>>("/api/settings/api-keys") });
  const [openaiKey, setOpenaiKey] = useState(""); const [geminiKey, setGeminiKey] = useState("");
  const [msg,setMsg]=useState<string|null>(null); const [err,setErr]=useState<string|null>(null);
  const save = useMutation({
    mutationFn: ({ provider, apiKey }: { provider:string; apiKey:string })=> api<{ success:boolean; data:{ keyHint:string } }>(`/api/settings/api-keys`, { method:"PUT", body: JSON.stringify({ provider, apiKey }) }),
    onSuccess: (_r, vars)=>{ setMsg(`${vars.provider} tersimpan`); setErr(null); qc.invalidateQueries({queryKey:["api-keys"]}); if(vars.provider==="openai") setOpenaiKey(""); else setGeminiKey(""); },
    onError: (e: unknown)=> setErr(e instanceof Error ? e.message : String(e)),
  });
  const test = useMutation({
    mutationFn: (provider:string)=> api<{ success:boolean; data:{ valid:boolean; models:string[] }; message?:string }>("/api/settings/api-keys/test", { method:"POST", body: JSON.stringify({ provider }) }),
    onSuccess: (r)=>{ setMsg(r.message ?? (r.data.valid ? "Key valid" : "Key invalid")); setErr(r.data.valid ? null : (r.message ?? "Invalid")); },
    onError:(e:unknown)=> setErr(e instanceof Error ? e.message : String(e)),
  });
  const rows = q.data?.data ?? [];
  const hint = (p:string)=> rows.find(r=>r.provider===p)?.keyHint ?? "—";
  return (
    <div className="grid gap-4">
      <Card>
        <div className="font-medium">BYOK — API Keys (AES-256-GCM)</div>
        <div className="mt-1 text-xs text-slate-500">Key terenkripsi server, tampil mask ****abcd. Test Key decrypt ephemeral.</div>
        {msg && <div className="mt-3"><Banner status="success">{msg}</Banner></div>}
        {err && <div className="mt-3"><Banner status="error">{err}</Banner></div>}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">OpenAI</span><Badge variant={hint("openai")!=="—" ? "success":"default"}>{hint("openai")}</Badge></div>
            <Field label="API Key (sk-...)"><input type="password" className="rounded-lg border px-3 py-2 font-mono text-sm" placeholder="sk-proj-..." value={openaiKey} onChange={e=>setOpenaiKey(e.target.value)} /></Field>
            <div className="mt-2 flex gap-2"><button className="rounded-full bg-[#1E3A5F] px-4 py-1.5 text-sm text-white" onClick={()=>save.mutate({provider:"openai", apiKey:openaiKey})} disabled={!openaiKey || save.isPending}>Save</button><button className="rounded-full border px-4 py-1.5 text-sm" onClick={()=>test.mutate("openai")} disabled={test.isPending}>Test</button></div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Gemini</span><Badge variant={hint("gemini")!=="—" ? "success":"default"}>{hint("gemini")}</Badge></div>
            <Field label="API Key (AIza...)"><input type="password" className="rounded-lg border px-3 py-2 font-mono text-sm" placeholder="AIza..." value={geminiKey} onChange={e=>setGeminiKey(e.target.value)} /></Field>
            <div className="mt-2 flex gap-2"><button className="rounded-full bg-[#1E3A5F] px-4 py-1.5 text-sm text-white" onClick={()=>save.mutate({provider:"gemini", apiKey:geminiKey})} disabled={!geminiKey || save.isPending}>Save</button><button className="rounded-full border px-4 py-1.5 text-sm" onClick={()=>test.mutate("gemini")} disabled={test.isPending}>Test</button></div>
          </div>
        </div>
      </Card>
    </div>
  );
}
