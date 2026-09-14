import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Text, Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Center } from "@astryxdesign/core/Center";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { ApiError } from "@/lib/api";
import { ADMIN_SESSION_KEY, adminChangePassword, adminLogin, fetchAdminSession } from "@/lib/admin";
import { Banner } from "./ui/Banner";
import { Panel } from "./ui/Panel";

/**
 * Mark ikon universitas untuk brand di atas kartu login.
 *
 * Astryx tidak menyediakan ikon "graduation cap" bawaan (registry berisi
 * ikon utilitas seperti chevron/warning) dan proyek belum memakai heroicons,
 * jadi mark ini digambar langsung — mengikuti pola template resmi Astryx
 * `login-card` yang juga menyertakan SVG brand langsung di file.
 */
function GraduationCapIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 3 1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" />
    </svg>
  );
}

// Halaman auth berdiri sendiri: mem-paint latar body-nya sendiri (mengikuti
// pola template `login-card` Astryx). AppShell menyembunyikan TopNav pada
// rute ini sehingga area ini benar-benar viewport-full.
const pageStyle: CSSProperties = {
  minHeight: "100%",
  backgroundColor: "var(--color-background-body)",
};
// Kolom kartu di-cap 400px tapi tetap boleh menyusut di layar sempit —
// Stack tidak punya `maxWidth`, jadi dipasang lewat style.
const contentStyle: CSSProperties = {
  width: "100%",
  maxWidth: 400,
};

/** Aturan ini mencerminkan `adminChangePasswordSchema` di server. */
const PASSWORD_RULES: { test: (v: string) => boolean; label: string }[] = [
  { test: (v) => v.length >= 12, label: "Minimal 12 karakter" },
  { test: (v) => /[a-z]/.test(v), label: "Ada huruf kecil" },
  { test: (v) => /[A-Z]/.test(v), label: "Ada huruf besar" },
  { test: (v) => /\d/.test(v), label: "Ada angka" },
];

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Ambil error per-field dari respons validasi server. */
function fieldError(e: unknown, field: string): string | undefined {
  return e instanceof ApiError ? e.fieldErrors[field]?.[0] : undefined;
}

export function AdminLoginForm() {
  const qc = useQueryClient();
  const nav = useNavigate();

  const session = useQuery({
    queryKey: ADMIN_SESSION_KEY,
    queryFn: fetchAdminSession,
    retry: false,
  });
  const identity = session.data ?? null;

  const [nidn, setNidn] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);

  const nidnLooksValid = /^\d{10}$/.test(nidn.trim());
  const canSubmit = nidnLooksValid && password.length > 0;

  const login = useMutation({
    mutationFn: () => adminLogin(nidn.trim(), password),
    onSuccess: (res) => {
      setError(null);
      setPassword("");
      qc.setQueryData(ADMIN_SESSION_KEY, res.data);
      qc.invalidateQueries({ queryKey: ["admin-programs"] });
      nav({ to: "/admin" });
    },
    onError: (e: unknown) => setError(e),
  });

  if (identity) {
    return identity.mustChangePassword
      ? <ForcedPasswordChange name={identity.name} />
      : (
        <Panel>
          <VStack gap={3}>
            <Text weight="semibold">{`Sudah login sebagai ${identity.name}`}</Text>
            <HStack>
              <Button label="Buka panel admin" variant="primary" onClick={() => nav({ to: "/admin" })} />
            </HStack>
          </VStack>
        </Panel>
      );
  }

  const serverNidnError = fieldError(error, "nidn");
  const nidnStatus = serverNidnError
    ? { type: "error" as const, message: serverNidnError }
    : nidn.length > 0 && !nidnLooksValid
      ? { type: "error" as const, message: "NIDN harus 10 digit angka" }
      : undefined;

  // Layout mengikuti template resmi Astryx `login-card` — satu kartu
  // terangkat di tengah viewport dengan brand di atasnya, input tanpa label
  // kasat mata, dan tombol primer full-width lg. Blok social sign-in +
  // Sign up + Terms dihilangkan karena aplikasi ini tak punya jalur itu:
  // akun dibuat pengelola dan sudah tunduk pada regulasi internal kampus.
  return (
    <Center axis="both" padding={6} style={pageStyle}>
      <VStack gap={4} hAlign="center" style={contentStyle}>
        {/* Logo */}
        <VStack gap={2} hAlign="center">
          <Icon icon={GraduationCapIcon} size="lg" />
          <Text type="body" weight="bold" size="lg">
            RPS OBE Generator
          </Text>
        </VStack>

        {/* Card */}
        <Card padding={8} width="100%">
          <VStack gap={4} hAlign="stretch">
            {/* Header */}
            <VStack gap={1} hAlign="center">
              <Heading level={2}>Selamat datang kembali</Heading>
              <Text type="body" color="secondary" size="sm">
                Masuk ke akun dosen Anda
              </Text>
            </VStack>

            {/* Form fields */}
            <VStack gap={2}>
              <TextInput
                label="NIDN"
                isLabelHidden
                placeholder="NIDN — 10 digit"
                value={nidn}
                onChange={(v) => setNidn(v.replace(/\D/g, "").slice(0, 10))}
                size="lg"
                status={nidnStatus}
              />
              <TextInput
                label="Password"
                isLabelHidden
                type="password"
                placeholder="Password"
                value={password}
                onChange={setPassword}
                size="lg"
              />
            </VStack>

            {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

            {/* Login button */}
            <Button
              label={login.isPending ? "Memeriksa…" : "Masuk"}
              variant="primary"
              size="lg"
              isLoading={login.isPending}
              isDisabled={!canSubmit}
              onClick={() => login.mutate()}
            />
          </VStack>
        </Card>

        {/* Info kontak — pengganti "Sign up" karena akun dibuat pengelola */}
        <VStack hAlign="center">
          <Text type="supporting" color="secondary">
            Belum punya akun? Hubungi pengelola sistem.
          </Text>
        </VStack>
      </VStack>
    </Center>
  );
}

/**
 * Ditampilkan saat akun masih memakai password bawaan. Server menolak semua
 * mutasi master data sampai password diganti, jadi tidak ada gunanya
 * menampilkan panel pengelolaan lebih dulu.
 */
export function ForcedPasswordChange({ name }: { name: string }) {
  const qc = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const unmet = PASSWORD_RULES.filter((r) => !r.test(newPassword));
  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const canSubmit = currentPassword.length > 0 && unmet.length === 0 && !mismatch && confirm.length > 0;

  const change = useMutation({
    mutationFn: () => adminChangePassword(currentPassword, newPassword),
    onSuccess: () => {
      setError(null);
      setDone(true);
      qc.setQueryData(ADMIN_SESSION_KEY, null);
      qc.removeQueries({ queryKey: ["admin-programs"] });
    },
    onError: (e: unknown) => setError(e),
  });

  if (done) {
    return (
      <Panel>
        <VStack gap={3}>
          <Banner status="success" title="Password diganti">
            Semua sesi lama sudah diakhiri. Silakan masuk kembali dengan password baru.
          </Banner>
          <HStack>
            <Button label="Ke halaman login" variant="primary" onClick={() => window.location.assign("/admin/login")} />
          </HStack>
        </VStack>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Ganti password dulu, ${name}`}
      description="Akun ini masih memakai password bawaan. Pengelolaan data baru terbuka setelah password diganti."
    >
      <div style={{ maxWidth: 420 }}>
        <VStack gap={3}>
          <TextInput label="Password saat ini" type="password" value={currentPassword} onChange={setCurrentPassword} />
          <TextInput label="Password baru" type="password" value={newPassword} onChange={setNewPassword} />
          <TextInput
            label="Ulangi password baru"
            type="password"
            value={confirm}
            onChange={setConfirm}
            status={mismatch ? { type: "error", message: "Belum sama dengan password baru" } : undefined}
          />

          <Panel padding={3}>
            <VStack gap={1}>
              <Text type="supporting">Syarat password</Text>
              <List density="compact">
                {PASSWORD_RULES.map((rule) => {
                  const ok = rule.test(newPassword);
                  return (
                    <ListItem
                      key={rule.label}
                      label={`${ok ? "✓" : "•"} ${rule.label}`}
                    />
                  );
                })}
              </List>
            </VStack>
          </Panel>

          {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

          <HStack>
            <Button
              label={change.isPending ? "Menyimpan…" : "Ganti password"}
              variant="primary"
              isLoading={change.isPending}
              isDisabled={!canSubmit}
              onClick={() => change.mutate()}
            />
          </HStack>
        </VStack>
      </div>
    </Panel>
  );
}
