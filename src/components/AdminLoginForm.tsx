import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { ApiError } from "@/lib/api";
import { ADMIN_SESSION_KEY, adminChangePassword, adminLogin, fetchAdminSession } from "@/lib/admin";
import { Banner } from "./ui/Banner";
import { Panel } from "./ui/Panel";

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
  const [showPassword, setShowPassword] = useState(false);
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

  return (
    <Panel
      title="Masuk panel admin"
      description="Gunakan NIDN (10 digit) dan password yang diberikan pengelola sistem."
    >
      <div style={{ maxWidth: 420 }}>
        <VStack gap={3}>
          <TextInput
            label="NIDN"
            value={nidn}
            onChange={(v) => setNidn(v.replace(/\D/g, "").slice(0, 10))}
            placeholder="0922038401"
            description="Nomor Induk Dosen Nasional, 10 digit"
            status={nidnStatus}
          />
          <VStack gap={2}>
            <TextInput
              label="Password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={setPassword}
              placeholder="••••••••••••"
            />
            <HStack justify="end">
              <Button
                label={showPassword ? "Sembunyikan" : "Tampilkan"}
                variant="ghost"
                size="sm"
                onClick={() => setShowPassword((v) => !v)}
              />
            </HStack>
          </VStack>
          {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}
          <HStack>
            <Button
              label={login.isPending ? "Memeriksa…" : "Masuk"}
              variant="primary"
              isLoading={login.isPending}
              isDisabled={!canSubmit}
              onClick={() => login.mutate()}
            />
          </HStack>
        </VStack>
      </div>
    </Panel>
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
