import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiOk } from "@/lib/api";
import { useState } from "react";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { Grid } from "@astryxdesign/core/Grid";

type KeysRow = { provider: string; keyHint: string | null; isActive: boolean };

function maskHint(hint: string | null) {
  if (!hint || hint === "—") return "—";
  return hint;
}

export function SettingsPanel() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<ApiOk<KeysRow[]>>("/api/settings/api-keys"),
  });

  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showOpenai, setShowOpenai] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  // per-provider test feedback — tampil cukup di bawah field (TextInput status), tidak duplikat Banner global
  const [testRes, setTestRes] = useState<Record<string, { valid: boolean; message: string; models?: string[]; loading?: boolean }>>({});

  const save = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      api<{ success: boolean; data: { keyHint: string } }>(`/api/settings/api-keys`, {
        method: "PUT",
        body: JSON.stringify({ provider, apiKey }),
      }),
    onSuccess: (_r, vars) => {
      setTestRes((s) => ({ ...s, [vars.provider]: { valid: true, message: `Tersimpan ${maskHint(_r.data?.keyHint ?? null)} — klik Test untuk validasi live` } }));
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      if (vars.provider === "openai") setOpenaiKey("");
      else setGeminiKey("");
    },
    onError: (e: unknown, vars) => {
      const m = e instanceof Error ? e.message : String(e);
      const p = (vars as { provider?: string } | undefined)?.provider ?? (geminiKey.trim().length >= 20 ? "gemini" : "openai");
      setTestRes((s) => ({ ...s, [p]: { valid: false, message: m } }));
    },
  });

  const test = useMutation({
    mutationFn: async (provider: string) => {
      setTestRes((s) => ({ ...s, [provider]: { valid: false, message: "Testing…", loading: true } }));
      try {
        const r = await api<{ success: boolean; data: { valid: boolean; models: string[] }; message?: string }>(`/api/settings/api-keys/test`, {
          method: "POST",
          body: JSON.stringify({ provider }),
        });
        const valid = !!r.data?.valid;
        // filter testimoni models hanya yang support generateContent untuk rps/2 dropdown (hindari aqa/tts/embedding/veo di default)
        const rawModels: string[] = r.data?.models ?? [];
        const preferred = rawModels.filter(
          (m) => /^(gemini-|gemma-)/.test(m) && !/(tts|embedding|veo|transcribe|native-audio|aqa|lyria|robotics|antigravity|deep-research)/i.test(m),
        );
        const modelsForCache = (preferred.length ? preferred : rawModels).slice(0, 50);
        const message = r.message ?? (valid ? `Valid — ${rawModels.length} model(s): ${modelsForCache.slice(0, 3).join(", ")}` : "Key invalid");
        setTestRes((s) => ({ ...s, [provider]: { valid, message, models: modelsForCache } }));
        try {
          if (valid && modelsForCache.length) {
            window.localStorage.setItem(`models:${provider}`, JSON.stringify(modelsForCache));
            window.dispatchEvent(new StorageEvent("storage", { key: `models:${provider}`, newValue: JSON.stringify(modelsForCache) }));
          }
        } catch {}
        qc.invalidateQueries({ queryKey: ["api-keys"] });
        return r;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        setTestRes((s) => ({ ...s, [provider]: { valid: false, message: m } }));
        throw e;
      }
    },
  });

  const rows = q.data?.data ?? [];
  const hint = (p: string) => rows.find((r) => r.provider === p)?.keyHint ?? "—";
  const hasOpenai = hint("openai") !== "—";
  const hasGemini = hint("gemini") !== "—";
  const isSavingOpenai = save.isPending && (save.variables as { provider?: string } | undefined)?.provider === "openai";
  const isSavingGemini = save.isPending && (save.variables as { provider?: string } | undefined)?.provider === "gemini";

  // helper for TextInput status (inline feedback)
  const openaiFieldStatus = (() => {
    if (testRes.openai && !testRes.openai.loading) {
      if (testRes.openai.valid) return { type: "success" as const, message: testRes.openai.message };
      return { type: "error" as const, message: testRes.openai.message };
    }
    return undefined;
  })();
  const geminiFieldStatus = (() => {
    if (testRes.gemini && !testRes.gemini.loading) {
      if (testRes.gemini.valid) return { type: "success" as const, message: testRes.gemini.message };
      return { type: "error" as const, message: testRes.gemini.message };
    }
    return undefined;
  })();

  return (
    <div className="grid gap-4">
      <Card>
        <Text weight="semibold">BYOK — API Keys (AES-256-GCM)</Text>
        <Text type="supporting">Key terenkripsi server (APP_ENCRYPTION_KEY 64 hex, AES-256-GCM). GET hanya mask ****abcd — plaintext tidak pernah dikembalikan. Test Key decrypt ephemeral. Refresh tetap tampil sebagai mask di placeholder. Kunci berlaku untuk seluruh institusi, bukan per akun.</Text>
        {q.isFetching && !q.data && <div className="mt-2"><Text type="supporting">Memuat keys…</Text></div>}

        <Grid columns={{ minWidth: 320 }} gap={4} className="mt-4">
          {/* OpenAI */}
          <Card>
            <div className="flex items-center justify-between gap-2">
              <Text weight="semibold">OpenAI</Text>
              <Badge variant={hasOpenai ? "success" : "default"}>{maskHint(hint("openai"))}</Badge>
            </div>
            <Text type="supporting">Format sk-... / sk-proj-... · <a className="underline text-accent" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a></Text>
            <div className="mt-3">
              <TextInput
                label="API Key"
                description={hasOpenai ? `Tersimpan ${maskHint(hint("openai"))} — refresh tetap tampil (masked) di placeholder. Ketik ulang untuk ganti.` : "Belum tersimpan — Generate AI butuh minimal 1 provider"}
                type={showOpenai ? "text" : "password"}
                value={openaiKey}
                onChange={setOpenaiKey}
                placeholder={hasOpenai ? maskHint(hint("openai")) : "sk-proj-..."}
                status={openaiFieldStatus}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button label={showOpenai ? "Hide" : "Show"} variant="secondary" size="sm" onClick={() => setShowOpenai((v) => !v)} />
              <Button
                label={isSavingOpenai ? "Saving…" : "Save"}
                variant="primary"
                size="sm"
                isDisabled={!openaiKey.trim() || openaiKey.trim().length < 10}
                isLoading={isSavingOpenai}
                onClick={() => save.mutate({ provider: "openai", apiKey: openaiKey.trim() })}
              />
              <Button
                label={testRes.openai?.loading ? "Testing…" : "Test"}
                variant="secondary"
                size="sm"
                isDisabled={!hasOpenai}
                isLoading={!!testRes.openai?.loading}
                tooltip={!hasOpenai ? "Simpan key dulu" : "Test via GET /v1/models"}
                onClick={() => test.mutate("openai")}
              />
            </div>

            {!hasOpenai && <div className="mt-2"><Text type="supporting">Belum ada key — Generate AI akan 422 sampai key disimpan.</Text></div>}
          </Card>

          {/* Gemini */}
          <Card>
            <div className="flex items-center justify-between gap-2">
              <Text weight="semibold">Gemini</Text>
              <Badge variant={hasGemini ? "success" : "default"}>{maskHint(hint("gemini"))}</Badge>
            </div>
            <Text type="supporting">Format AIza... atau AQ... (Vertex) — min 20 char · <a className="underline text-accent" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">aistudio.google.com/app/apikey</a></Text>
            <div className="mt-3">
              <TextInput
                label="API Key"
                description={hasGemini ? `Tersimpan ${maskHint(hint("gemini"))} — refresh tetap tampil (masked) di placeholder. Ketik ulang untuk ganti.` : "Opsional — cukup salah satu provider untuk demo; AQ... tetap valid"}
                type={showGemini ? "text" : "password"}
                value={geminiKey}
                onChange={setGeminiKey}
                placeholder={hasGemini ? maskHint(hint("gemini")) : "AQ..."}
                status={geminiFieldStatus}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button label={showGemini ? "Hide" : "Show"} variant="secondary" size="sm" onClick={() => setShowGemini((v) => !v)} />
              <Button
                label={isSavingGemini ? "Saving…" : "Save"}
                variant="primary"
                size="sm"
                isDisabled={!geminiKey.trim() || geminiKey.trim().length < 20}
                isLoading={isSavingGemini}
                onClick={() => save.mutate({ provider: "gemini", apiKey: geminiKey.trim() })}
              />
              <Button
                label={testRes.gemini?.loading ? "Testing…" : "Test"}
                variant="secondary"
                size="sm"
                isDisabled={!hasGemini}
                isLoading={!!testRes.gemini?.loading}
                tooltip={!hasGemini ? "Simpan key dulu" : "Test via GET /v1beta/models"}
                onClick={() => test.mutate("gemini")}
              />
            </div>
            {!hasGemini && <div className="mt-2"><Text type="supporting">Opsional — cukup salah satu provider untuk demo. Jika sudah simpan, refresh tetap tampil sebagai {maskHint(hint("gemini"))} di field.</Text></div>}
          </Card>
        </Grid>
        <div className="mt-4">
          <Text type="supporting">Enter untuk save · Test butuh key tersimpan (decrypt ephemeral ke provider) · key tidak pernah dikembalikan plaintext — hanya mask yang tampil setelah refresh.</Text>
        </div>
      </Card>
    </div>
  );
}
