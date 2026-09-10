import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiOk } from "@/lib/api";
import { Card } from "./ui/Card";
import { Banner } from "./ui/Banner";
import { Badge } from "./ui/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI (sk-...)" },
  { value: "gemini", label: "Gemini (AIza... / AQ...)" },
];
const OPENAI_FALLBACK = [
  { value: "gpt-4o-mini", label: "gpt-4o-mini" },
  { value: "gpt-4o", label: "gpt-4o" },
];
const GEMINI_FALLBACK = [
  { value: "gemini-1.5-flash", label: "gemini-1.5-flash" },
  { value: "gemini-1.5-pro", label: "gemini-1.5-pro" },
];

type KeysRow = { provider: string; keyHint: string | null; isActive: boolean };

export function AiGeneratePanel({ id }: { id: number }) {
  const qc = useQueryClient();

  const keysQ = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<ApiOk<KeysRow[]>>("/api/settings/api-keys"),
  });
  const rows = keysQ.data?.data ?? [];
  const has = (p: string) => rows.some((r) => r.provider === p && r.keyHint && r.keyHint !== "—");
  const hasAny = has("openai") || has("gemini");
  const hint = (p: string) => rows.find((r) => r.provider === p)?.keyHint ?? "—";
  const selectorOptions = PROVIDER_OPTIONS.map((o) => ({
    ...o,
    disabled: !has(o.value),
    description: has(o.value) ? `Tersimpan ${hint(o.value)}` : "Belum ada key — atur di Settings",
  }));

  const [provider, setProvider] = useState<"openai" | "gemini">("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!keysQ.isSuccess || rows.length === 0) return;
    const want: "openai" | "gemini" = has("gemini") ? "gemini" : has("openai") ? "openai" : "openai";
    if (!has(provider) && has(want) && provider !== want) {
      setProvider(want);
    }
  }, [keysQ.isSuccess, rows.length, provider]);

  // dropdown Model dinamis dari API key — via POST /api/settings/api-keys/test (live) + localStorage cache dari /settings Test
  const modelsQ = useQuery({
    queryKey: ["api-key-models", provider],
    enabled: has(provider),
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const r = await api<{ success: boolean; data: { valid: boolean; models: string[] }; message?: string }>(
        "/api/settings/api-keys/test",
        { method: "POST", body: JSON.stringify({ provider }) },
      );
      if (!r.data?.valid) throw new Error(r.message ?? "Key invalid");
      const models = (r.data.models ?? []).slice(0, 50);
      try {
        window.localStorage.setItem(`models:${provider}`, JSON.stringify(models));
      } catch {}
      return models;
    },
  });

  // sync cache dari SettingsPanel Test via localStorage + storage event (jadi Test di /settings langsung update rps/2 tanpa reload)
  const [, forceTick] = useState(0);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("models:")) {
        const m = e.key.split(":")[1];
        if (m) {
          try {
            const raw = e.newValue ? (JSON.parse(e.newValue) as string[]) : null;
            if (raw?.length) qc.setQueryData(["api-key-models", m], raw);
          } catch {}
        }
        forceTick((x) => x + 1);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [qc]);

  const cachedModels = (() => {
    // 1) react-query live, 2) localStorage dari SettingsPanel, 3) fallback statis
    if (modelsQ.data?.length) return modelsQ.data;
    try {
      const c = typeof window !== "undefined" ? window.localStorage.getItem(`models:${provider}`) : null;
      if (c) {
        const arr = JSON.parse(c) as string[];
        if (arr.length) return arr;
      }
    } catch {}
    return null;
  })();

  const fallbackValues = provider === "openai" ? OPENAI_FALLBACK.map((m) => m.value) : GEMINI_FALLBACK.map((m) => m.value);
  const modelSource = cachedModels ?? fallbackValues;
  const selectedModelOptions = modelSource.map((m) => ({ value: m, label: m }));

  useEffect(() => {
    if (selectedModelOptions.length > 0 && !selectedModelOptions.some((o) => o.value === model)) {
      setModel(selectedModelOptions[0].value);
    }
  }, [provider, modelSource.join(",")]);

  const m = useMutation({
    mutationFn: () =>
      api<{ success: boolean; data: unknown; message?: string }>(`/api/rps/${id}/ai/generate`, {
        method: "POST",
        body: JSON.stringify({ provider, model }),
      }),
    onSuccess: (r) => {
      setMsg(r.message ?? "AI generated");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["rps", id] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const providerHint = has(provider) ? `Tersimpan ${hint(provider)} ✓` : "Belum ada key";
  const modelDesc = modelsQ.isFetching
    ? "Memuat models live dari provider…"
    : cachedModels
      ? `${cachedModels.length} model(s) live dari Test API — sinkron dengan /settings`
      : provider === "openai"
        ? "OpenAI chat completions (fallback — klik Test di Settings untuk live)"
        : "Gemini v1beta generateContent (fallback — klik Test di Settings untuk live)";

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text weight="semibold">Generate AI — 9 baris mewakili 16 minggu</Text>
        <Badge variant={hasAny ? "success" : "warning"}>{hasAny ? "Key ready" : "Belum ada key — atur di Settings"}</Badge>
      </div>
      {!hasAny && (
        <div className="mt-3">
          <Banner status="warning">Belum ada API key — simpan di Settings dulu. Dropdown provider sinkron dengan Settings (yang belum ada key akan disabled).</Banner>
        </div>
      )}
      {keysQ.isSuccess && hasAny && !has(provider) && (
        <div className="mt-3">
          <Banner status="warning">Provider terpilih belum ada key ({provider}: {hint(provider)}) — pilih provider yang tersimpan atau simpan key di Settings.</Banner>
        </div>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Selector
          label="Provider"
          value={provider}
          onChange={(v) => {
            const nv = v as "openai" | "gemini";
            setProvider(nv);
            setMsg(null);
            setErr(null);
          }}
          options={selectorOptions}
          description={providerHint}
        />
        <Selector
          label="Model"
          value={model}
          onChange={setModel}
          options={selectedModelOptions}
          description={modelDesc}
        />
      </div>
      <div className="mt-1">
        <Text type="supporting">Provider sinkron dengan Settings — hanya provider yang sudah Save (tersimpan {rows.map((r) => `${r.provider}:${r.keyHint}`).join(" · ") || "— belum ada"}) yang enabled.</Text>
      </div>
      {modelsQ.isError && has(provider) && (
        <div className="mt-2">
          <Text type="supporting">Gagal load models live: {modelsQ.error instanceof Error ? modelsQ.error.message : String(modelsQ.error)} — pakai fallback. Klik Test di Settings untuk refresh.</Text>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          label={m.isPending ? "Generating…" : "Generate 9 baris (16 minggu)"}
          variant="primary"
          isLoading={m.isPending}
          isDisabled={!has(provider)}
          tooltip={!has(provider) ? `Simpan key ${provider} di Settings dulu` : undefined}
          onClick={() => m.mutate()}
        />
        <Button label="Atur API Key" variant="secondary" href="/settings" />
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
      <div className="mt-3">
        <Text type="supporting">Rule: weight non-merge 100 (R35 5, R36 5, R37 10, R38 20, R40 30, R41 10, R42 20) + is_merged UTS (8) &amp; UAS (16) = 0. Hooks: pandemic, Daring/Luring, kop Megarezky.</Text>
      </div>
    </Card>
  );
}
