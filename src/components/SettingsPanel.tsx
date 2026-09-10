import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiOk } from "@/lib/api";
import { useState } from "react";
import { Card } from "./ui/Card";
import { Field } from "./ui/Field";
import { Banner } from "./ui/Banner";
import { Badge } from "./ui/Badge";

function maskHint(hint: string | null) {
  if (!hint || hint === "—") return "—";
  return hint;
}

export function SettingsPanel() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<ApiOk<{ provider: string; keyHint: string | null; isActive: boolean }[]>>("/api/settings/api-keys"),
  });
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showOpenai, setShowOpenai] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      api<{ success: boolean; data: { keyHint: string } }>(`/api/settings/api-keys`, {
        method: "PUT",
        body: JSON.stringify({ provider, apiKey }),
      }),
    onSuccess: (_r, vars) => {
      setMsg(`${vars.provider} tersimpan — hint ${maskHint(_r.data?.keyHint ?? null)}`);
      setErr(null);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      if (vars.provider === "openai") setOpenaiKey("");
      else setGeminiKey("");
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const test = useMutation({
    mutationFn: (provider: string) =>
      api<{ success: boolean; data: { valid: boolean; models: string[] }; message?: string }>(`/api/settings/api-keys/test`, {
        method: "POST",
        body: JSON.stringify({ provider }),
      }),
    onSuccess: (r) => {
      setMsg(r.message ?? (r.data.valid ? `Valid — ${r.data.models.length} model(s)` : "Key invalid"));
      setErr(r.data.valid ? null : (r.message ?? "Invalid"));
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const rows = q.data?.data ?? [];
  const hint = (p: string) => rows.find((r) => r.provider === p)?.keyHint ?? "—";
  const hasOpenai = hint("openai") !== "—";
  const hasGemini = hint("gemini") !== "—";

  return (
    <div className="grid gap-4">
      <Card>
        <div className="font-medium text-slate-900">BYOK — API Keys (AES-256-GCM)</div>
        <div className="mt-1 text-xs leading-relaxed text-slate-500">
          Key terenkripsi server (`APP_ENCRYPTION_KEY` 64 hex, AES-256-GCM). GET hanya mask <code className="rounded bg-slate-100 px-1">****abcd</code>. Test Key decrypt ephemeral. Tanpa login — global single-tenant.
        </div>
        {msg && (
          <div className="mt-3">
            <Banner status="success">{msg}</Banner>
          </div>
        )}
        {err && (
          <div className="mt-3">
            <Banner status="error">{err}</Banner>
          </div>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">OpenAI</span>
              <Badge variant={hasOpenai ? "success" : "default"}>{maskHint(hint("openai"))}</Badge>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Format <code className="rounded bg-slate-100 px-1">sk-...</code> / <code className="rounded bg-slate-100 px-1">sk-proj-...</code> ·{" "}
              <a className="text-[#1E3A5F] underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                platform.openai.com/api-keys
              </a>
            </div>
            <Field label="API Key (sk-...)">
              <div className="flex gap-2">
                <input
                  type={showOpenai ? "text" : "password"}
                  className="flex-1 rounded-lg border px-3 py-2 font-mono text-sm focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
                  placeholder="sk-proj-..."
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && openaiKey) save.mutate({ provider: "openai", apiKey: openaiKey });
                  }}
                />
                <button
                  type="button"
                  className="rounded-full border px-3 py-1.5 text-xs"
                  onClick={() => setShowOpenai((v) => !v)}
                  aria-label={showOpenai ? "Sembunyikan" : "Tampilkan"}
                >
                  {showOpenai ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded-full bg-[#1E3A5F] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-40"
                onClick={() => save.mutate({ provider: "openai", apiKey: openaiKey })}
                disabled={!openaiKey || save.isPending}
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
              <button
                className="rounded-full border px-4 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
                onClick={() => test.mutate("openai")}
                disabled={test.isPending || !hasOpenai}
                title={!hasOpenai ? "Simpan key dulu" : "Test via GET /v1/models"}
              >
                {test.isPending ? "Test…" : "Test"}
              </button>
            </div>
            {!hasOpenai && <div className="mt-2 text-xs text-amber-700">Belum ada key — Generate AI akan 422 sampai key disimpan.</div>}
          </div>

          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Gemini</span>
              <Badge variant={hasGemini ? "success" : "default"}>{maskHint(hint("gemini"))}</Badge>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Format <code className="rounded bg-slate-100 px-1">AIza...</code> ·{" "}
              <a className="text-[#1E3A5F] underline" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/app/apikey
              </a>
            </div>
            <Field label="API Key (AIza...)">
              <div className="flex gap-2">
                <input
                  type={showGemini ? "text" : "password"}
                  className="flex-1 rounded-lg border px-3 py-2 font-mono text-sm focus:border-[#1E3A5F] focus:outline-none focus:ring-1 focus:ring-[#1E3A5F]"
                  placeholder="AIza..."
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && geminiKey) save.mutate({ provider: "gemini", apiKey: geminiKey });
                  }}
                />
                <button
                  type="button"
                  className="rounded-full border px-3 py-1.5 text-xs"
                  onClick={() => setShowGemini((v) => !v)}
                  aria-label={showGemini ? "Sembunyikan" : "Tampilkan"}
                >
                  {showGemini ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded-full bg-[#1E3A5F] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-40"
                onClick={() => save.mutate({ provider: "gemini", apiKey: geminiKey })}
                disabled={!geminiKey || save.isPending}
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
              <button
                className="rounded-full border px-4 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
                onClick={() => test.mutate("gemini")}
                disabled={test.isPending || !hasGemini}
                title={!hasGemini ? "Simpan key dulu" : "Test via GET /v1beta/models"}
              >
                {test.isPending ? "Test…" : "Test"}
              </button>
            </div>
            {!hasGemini && <div className="mt-2 text-xs text-slate-500">Opsional — cukup salah satu provider untuk demo.</div>}
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-400">Enter untuk save · Test butuh key tersimpan · key tidak pernah dikembalikan plaintext.</div>
      </Card>
    </div>
  );
}
