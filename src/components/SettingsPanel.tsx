import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Link as AstryxLink } from "@astryxdesign/core/Link";
import { ADMIN_SESSION_KEY, fetchAdminSession } from "@/lib/admin";
import { api, type ApiOk } from "@/lib/api";
import { Panel } from "./ui/Panel";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";

type KeysRow = { provider: string; keyHint: string | null; isActive: boolean };

function maskHint(hint: string | null) {
  if (!hint || hint === "—") return "—";
  return hint;
}

/**
 * Halaman Settings BYOK: dua kartu provider (OpenAI & Gemini).
 *
 * Sebelumnya susunan kartu memakai `<Card>` bersarang + `<div className=
 * "grid gap-...">`. Sekarang memakai `Panel` (kartu berjudul), `Grid`
 * responsif Astryx, dan `HStack`/`VStack` supaya jarak antar tombol dan
 * penyusunan status seragam dengan halaman lain.
 */
export function SettingsPanel() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ADMIN_SESSION_KEY, queryFn: fetchAdminSession, retry: false });
  const identity = session.data ?? null;
  const q = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<ApiOk<KeysRow[]>>("/api/settings/api-keys"),
    enabled: !!identity,
  });

  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [showOpenai, setShowOpenai] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
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
        const rawModels: string[] = r.data?.models ?? [];
        // Hanya model generateContent yang berguna untuk RPS; sisanya (tts,
        // embedding, dst.) memenuhi dropdown dan menyesatkan pengguna.
        const preferred = rawModels.filter(
          (m) => /^(gemini-|gemma-)/.test(m) && !/(tts|embedding|veo|transcribe|native-audio|aqa|lyria|robotics|antigravity|deep-research)/i.test(m),
        );
        const modelsForCache = (preferred.length ? preferred : rawModels).slice(0, 50);
        const message = r.message ?? (valid ? `Valid — ${rawModels.length} model tersedia: ${modelsForCache.slice(0, 3).join(", ")}` : "Key invalid");
        setTestRes((s) => ({ ...s, [provider]: { valid, message, models: modelsForCache } }));
        try {
          if (valid && modelsForCache.length) {
            window.localStorage.setItem(`models:${provider}`, JSON.stringify(modelsForCache));
            window.dispatchEvent(new StorageEvent("storage", { key: `models:${provider}`, newValue: JSON.stringify(modelsForCache) }));
          }
        } catch { /* localStorage tak tersedia — abaikan */ }
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
  const hasAnyKey = hasOpenai || hasGemini;
  const isSavingOpenai = save.isPending && (save.variables as { provider?: string } | undefined)?.provider === "openai";
  const isSavingGemini = save.isPending && (save.variables as { provider?: string } | undefined)?.provider === "gemini";

  const statusFor = (p: "openai" | "gemini") => {
    const r = testRes[p];
    if (!r || r.loading) return undefined;
    return r.valid
      ? ({ type: "success" as const, message: r.message } as const)
      : ({ type: "error" as const, message: r.message } as const);
  };

  if (session.isLoading) return <Text type="supporting">Memuat sesi…</Text>;

  if (!identity) {
    return (
      <Panel title="Masuk untuk mengatur API key" description="API key melekat pada akun Anda sendiri, jadi pengaturannya memerlukan login.">
        <Link to="/admin/login"><Button label="Ke halaman masuk" variant="primary" size="sm" /></Link>
      </Panel>
    );
  }

  return (
    <Panel
      title={`API Key Anda — ${identity.name}`}
      description="Kunci ini milik akun Anda sendiri: biaya dan kuota AI melekat pada pemakainya, dan pengguna lain tidak bisa melihat maupun memakainya. Disimpan terenkripsi AES-256-GCM; yang ditampilkan hanya 4 karakter terakhir — plaintext tidak pernah dikembalikan server."
    >
      <VStack gap={4}>
        {!hasAnyKey && (
          <Banner status="warning" title="Belum ada API key">
            Simpan minimal satu kunci sebelum membuat RPS. Institusi tidak menyediakan kunci
            bersama, sehingga setiap penulis memakai kuncinya sendiri.
          </Banner>
        )}
        {q.isFetching && !q.data && <Text type="supporting">Memuat keys…</Text>}

        <Grid columns={{ minWidth: 320 }} gap={4}>
          <ProviderCard
            title="OpenAI"
            hint={hint("openai")}
            hasKey={hasOpenai}
            docsLabel="platform.openai.com/api-keys"
            docsHref="https://platform.openai.com/api-keys"
            format="Format sk-... / sk-proj-..."
            value={openaiKey}
            onChangeValue={setOpenaiKey}
            show={showOpenai}
            onToggleShow={() => setShowOpenai((v) => !v)}
            placeholder="sk-proj-..."
            fieldStatus={statusFor("openai")}
            minLength={10}
            isSaving={isSavingOpenai}
            isTesting={!!testRes.openai?.loading}
            onSave={() => save.mutate({ provider: "openai", apiKey: openaiKey.trim() })}
            onTest={() => test.mutate("openai")}
            emptyMessage="Belum ada key — Generate AI akan 422 sampai key disimpan."
          />
          <ProviderCard
            title="Gemini"
            hint={hint("gemini")}
            hasKey={hasGemini}
            docsLabel="aistudio.google.com/app/apikey"
            docsHref="https://aistudio.google.com/app/apikey"
            format="Format AIza... atau AQ... (Vertex) — min 20 karakter"
            value={geminiKey}
            onChangeValue={setGeminiKey}
            show={showGemini}
            onToggleShow={() => setShowGemini((v) => !v)}
            placeholder="AQ..."
            fieldStatus={statusFor("gemini")}
            minLength={20}
            isSaving={isSavingGemini}
            isTesting={!!testRes.gemini?.loading}
            onSave={() => save.mutate({ provider: "gemini", apiKey: geminiKey.trim() })}
            onTest={() => test.mutate("gemini")}
            emptyMessage={`Opsional — cukup salah satu provider. Jika sudah simpan, refresh tetap tampil ${maskHint(hint("gemini"))} di field.`}
          />
        </Grid>

        <Text type="supporting">
          Enter untuk save · Test butuh key tersimpan (dekripsi sesaat ke provider) · key tidak
          pernah dikembalikan plaintext — hanya mask yang tampil setelah refresh.
        </Text>
      </VStack>
    </Panel>
  );
}

/**
 * Sub-panel per provider: sengaja diekstrak supaya tidak menduplikat 40 baris
 * dua kali dan agar perilaku (save/test/show, disabled state) konsisten.
 */
function ProviderCard({
  title, hint, hasKey, docsLabel, docsHref, format,
  value, onChangeValue, show, onToggleShow, placeholder, fieldStatus,
  minLength, isSaving, isTesting, onSave, onTest, emptyMessage,
}: {
  title: string;
  hint: string;
  hasKey: boolean;
  docsLabel: string;
  docsHref: string;
  format: string;
  value: string;
  onChangeValue: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder: string;
  fieldStatus?: { type: "success" | "error"; message: string };
  minLength: number;
  isSaving: boolean;
  isTesting: boolean;
  onSave: () => void;
  onTest: () => void;
  emptyMessage: string;
}) {
  return (
    <Panel
      title={title}
      description={format}
      headingLevel={4}
      actions={<Badge variant={hasKey ? "success" : "default"}>{maskHint(hint)}</Badge>}
    >
      <VStack gap={3}>
        <Text type="supporting">
          <AstryxLink href={docsHref} rel="noreferrer" target="_blank">{docsLabel}</AstryxLink>
        </Text>
        <TextInput
          label="API Key"
          description={
            hasKey
              ? `Tersimpan ${maskHint(hint)} — refresh tetap tampil (masked) di placeholder. Ketik ulang untuk ganti.`
              : `Belum tersimpan — kunci Anda sendiri, wajib ada sebelum membuat RPS`
          }
          type={show ? "text" : "password"}
          value={value}
          onChange={onChangeValue}
          placeholder={hasKey ? maskHint(hint) : placeholder}
          status={fieldStatus}
        />
        <HStack gap={2}>
          <Button label={show ? "Sembunyikan" : "Tampilkan"} variant="secondary" size="sm" onClick={onToggleShow} />
          <Button
            label={isSaving ? "Menyimpan…" : "Simpan"}
            variant="primary"
            size="sm"
            isDisabled={!value.trim() || value.trim().length < minLength}
            isLoading={isSaving}
            onClick={onSave}
          />
          <Button
            label={isTesting ? "Menguji…" : "Test"}
            variant="secondary"
            size="sm"
            isDisabled={!hasKey}
            isLoading={isTesting}
            tooltip={!hasKey ? "Simpan key dulu" : "Uji langsung ke penyedia"}
            onClick={onTest}
          />
        </HStack>
        {!hasKey && <Text type="supporting">{emptyMessage}</Text>}
      </VStack>
    </Panel>
  );
}
