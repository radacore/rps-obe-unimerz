import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiOk } from "@/lib/api";
import { Card } from "./ui/Card";
import { Banner } from "./ui/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
];

type KeysRow = { provider: string; keyHint: string | null };

export function AiGeneratePanel({ id }: { id: number }) {
  const qc = useQueryClient();
  const keysQ = useQuery({ queryKey: ["api-keys"], queryFn: () => api<ApiOk<KeysRow[]>>("/api/settings/api-keys") });
  const rows = keysQ.data?.data ?? [];
  const has = (p: string) => rows.some((r) => r.provider === p && r.keyHint && r.keyHint !== "—");
  const hasAny = has("openai") || has("gemini");

  const [provider, setProvider] = useState<"openai" | "gemini">("gemini");
  const [model, setModel] = useState("gemini-3.6-flash");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!keysQ.isSuccess || rows.length === 0) return;
    const want: "openai" | "gemini" = has("gemini") ? "gemini" : "openai";
    if (!has(provider) && has(want)) setProvider(want);
  }, [keysQ.isSuccess, rows.length, provider]);

  const modelsQ = useQuery({
    queryKey: ["api-key-models", provider],
    enabled: has(provider),
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const r = await api<{ success: boolean; data: { valid: boolean; models: string[] } }>("/api/settings/api-keys/test", { method: "POST", body: JSON.stringify({ provider }) });
      if (!r.data?.valid) throw new Error("Kunci tidak valid");
      const models = (r.data.models ?? []).slice(0, 50);
      try { window.localStorage.setItem(`models:${provider}`, JSON.stringify(models)); } catch {}
      return models;
    },
  });

  const cachedModels = (() => {
    if (modelsQ.data?.length) return modelsQ.data;
    try {
      const c = window.localStorage.getItem(`models:${provider}`);
      if (c) { const arr = JSON.parse(c) as string[]; if (arr.length) return arr; }
    } catch {}
    return null;
  })();

  const fallback = provider === "openai" ? ["gpt-4o-mini", "gpt-4o"] : ["gemini-3.6-flash", "gemini-3.5-flash"];
  const modelOptions = (cachedModels ?? fallback).map((m) => ({ value: m, label: m }));
  useEffect(() => {
    if (modelOptions.length && !modelOptions.some((o) => o.value === model)) setModel(modelOptions[0].value);
  }, [provider, (cachedModels ?? fallback).join(",")]);

  const m = useMutation({
    mutationFn: () => api<{ success: boolean; message?: string }>(`/api/rps/${id}/ai/generate`, { method: "POST", body: JSON.stringify({ provider, model }) }),
    onSuccess: (r) => { setMsg(r.message ?? "Berhasil dibuat."); setErr(null); qc.invalidateQueries({ queryKey: ["rps", id] }); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Card>
      <Text weight="semibold">Isi otomatis dengan AI</Text>
      <Text type="supporting">Buat capaian dan rencana mingguan otomatis sesuai data mata kuliah.</Text>
      {!hasAny && <div className="mt-3"><Banner status="warning">Belum ada API key. Atur di Pengaturan.</Banner></div>}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Selector label="Penyedia" value={provider} onChange={(v) => setProvider(v as "openai" | "gemini")} options={PROVIDER_OPTIONS.map((o) => ({ ...o, disabled: !has(o.value) }))} />
        <Selector label="Model" value={model} onChange={setModel} options={modelOptions} />
      </div>
      <div className="mt-3 flex gap-2">
        <Button label={m.isPending ? "Membuat…" : "Buat dengan AI"} variant="primary" isLoading={m.isPending} isDisabled={!has(provider)} onClick={() => m.mutate()} />
        <Button label="Pengaturan" variant="secondary" href="/settings" />
      </div>
      {msg && <div className="mt-3"><Banner status="success">{msg}</Banner></div>}
      {err && <div className="mt-3"><Banner status="error">{err}</Banner></div>}
    </Card>
  );
}
