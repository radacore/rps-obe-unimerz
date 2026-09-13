import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ApiError } from "@/lib/api";
import { adminChangePassword, adminLogin, fetchAdminMe } from "@/lib/admin";
import { Banner } from "./ui/Banner";
import { Card } from "./ui/Card";

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
    queryKey: ["admin-me"],
    queryFn: fetchAdminMe,
    retry: false,
    // 401 adalah jawaban yang sah di sini ("belum login"), bukan kegagalan.
    throwOnError: false,
  });
  const identity = session.data?.data ?? null;

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
      qc.setQueryData(["admin-me"], res);
      qc.invalidateQueries({ queryKey: ["admin-programs"] });
      nav({ to: "/admin" });
    },
    onError: (e: unknown) => setError(e),
  });

  if (identity) {
    return identity.mustChangePassword
      ? <ForcedPasswordChange name={identity.name} />
      : (
        <Card>
          <Text weight="semibold">Sudah login sebagai {identity.name}</Text>
          <div className="mt-3">
            <Button label="Buka panel admin" variant="primary" onClick={() => nav({ to: "/admin" })} />
          </div>
        </Card>
      );
  }

  const serverNidnError = fieldError(error, "nidn");
  const nidnStatus = serverNidnError
    ? { type: "error" as const, message: serverNidnError }
    : nidn.length > 0 && !nidnLooksValid
      ? { type: "error" as const, message: "NIDN harus 10 digit angka" }
      : undefined;

  return (
    <Card>
      <Text weight="semibold">Masuk panel admin</Text>
      <Text type="supporting">
        Gunakan NIDN (10 digit) dan password yang diberikan pengelola sistem.
      </Text>

      <div className="mt-4 grid max-w-md gap-3">
        <TextInput
          label="NIDN"
          value={nidn}
          onChange={(v) => setNidn(v.replace(/\D/g, "").slice(0, 10))}
          placeholder="0922038401"
          description="Nomor Induk Dosen Nasional, 10 digit"
          status={nidnStatus}
        />
        <div className="grid gap-2">
          <TextInput
            label="Password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={setPassword}
            placeholder="••••••••••••"
          />
          <div className="flex justify-end">
            <Button
              label={showPassword ? "Sembunyikan" : "Tampilkan"}
              variant="ghost"
              size="sm"
              onClick={() => setShowPassword((v) => !v)}
            />
          </div>
        </div>

        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        <div>
          <Button
            label={login.isPending ? "Memeriksa…" : "Masuk"}
            variant="primary"
            isLoading={login.isPending}
            isDisabled={!canSubmit}
            onClick={() => login.mutate()}
          />
        </div>
      </div>
    </Card>
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
      // Server mencabut semua sesi termasuk yang sedang dipakai, jadi cache
      // sesi lokal harus ikut dibuang.
      qc.setQueryData(["admin-me"], undefined);
      qc.removeQueries({ queryKey: ["admin-programs"] });
    },
    onError: (e: unknown) => setError(e),
  });

  if (done) {
    return (
      <Card>
        <Banner status="success" title="Password diganti">
          Semua sesi lama sudah diakhiri. Silakan masuk kembali dengan password baru.
        </Banner>
        <div className="mt-3">
          <Button label="Ke halaman login" variant="primary" onClick={() => window.location.assign("/admin/login")} />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <Text weight="semibold">Ganti password dulu, {name}</Text>
      <Text type="supporting">
        Akun ini masih memakai password bawaan. Pengelolaan data baru terbuka setelah password diganti.
      </Text>

      <div className="mt-4 grid max-w-md gap-3">
        <TextInput label="Password saat ini" type="password" value={currentPassword} onChange={setCurrentPassword} />
        <TextInput label="Password baru" type="password" value={newPassword} onChange={setNewPassword} />
        <TextInput
          label="Ulangi password baru"
          type="password"
          value={confirm}
          onChange={setConfirm}
          status={mismatch ? { type: "error", message: "Belum sama dengan password baru" } : undefined}
        />

        <div className="rounded-lg border border-border bg-muted px-3 py-2">
          <Text type="supporting">Syarat password</Text>
          <ul className="mt-1 grid gap-1">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(newPassword);
              return (
                <li key={rule.label} className={`text-xs ${ok ? "text-accent" : "text-secondary"}`}>
                  {ok ? "✓" : "•"} {rule.label}
                </li>
              );
            })}
          </ul>
        </div>

        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        <div>
          <Button
            label={change.isPending ? "Menyimpan…" : "Ganti password"}
            variant="primary"
            isLoading={change.isPending}
            isDisabled={!canSubmit}
            onClick={() => change.mutate()}
          />
        </div>
      </div>
    </Card>
  );
}
