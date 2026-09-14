import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { api, type ApiOk } from "@/lib/api";
import { Panel } from "./ui/Panel";
import { Banner } from "./ui/Banner";

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
      try { window.localStorage.setItem(`models:${provider}`, JSON.stringify(models)); } catch { /* storage tak tersedia */ }
      return models;
    },
  });

  const cachedModels = (() => {
    if (modelsQ.data?.length) return modelsQ.data;
    try {
      const c = window.localStorage.getItem(`models:${provider}`);
      if (c) { const arr = JSON.parse(c) as string[]; if (arr.length) return arr; }
    } catch { /* storage tak tersedia */ }
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
    <Panel
      title="Isi otomatis dengan AI"
      description="Buat capaian dan rencana mingguan otomatis sesuai data mata kuliah."
    >
      <VStack gap={3}>
        {!hasAny && <Banner status="warning">Belum ada API key. Atur di Settings.</Banner>}
        <Grid columns={2} gap={3}>
          <Selector
            label="Penyedia"
            value={provider}
            onChange={(v) => setProvider(v as "openai" | "gemini")}
            options={PROVIDER_OPTIONS.map((o) => ({ ...o, disabled: !has(o.value) }))}
          />
          <Selector label="Model" value={model} onChange={setModel} options={modelOptions} />
        </Grid>
        <HStack gap={2}>
          <Button
            label={m.isPending ? "Membuat…" : "Buat dengan AI"}
            variant="primary"
            isLoading={m.isPending}
            isDisabled={!has(provider)}
            onClick={() => m.mutate()}
          />
          <Button label="Buka Settings" variant="secondary" href="/settings" />
        </HStack>
        {msg && <Banner status="success">{msg}</Banner>}
        {err && <Banner status="error">{err}</Banner>}
      </VStack>
    </Panel>
  );
}
