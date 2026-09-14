import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Grid } from "@astryxdesign/core/Grid";
import { Code } from "@astryxdesign/core/Code";
import { ApiError } from "@/lib/api";
import {
  ROLE_LABEL, ROLE_OPTIONS, createAccount, fetchAccounts, resetAccountPassword, updateAccount,
  type AdminAccount, type AdminRole, type NewAccountInput,
} from "@/lib/admin";
import { useFaculties } from "@/lib/useFaculties";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Panel } from "./ui/Panel";

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Object.values(e.fieldErrors)[0]?.[0];
    if (first) return first;
  }
  return e instanceof Error ? e.message : String(e);
}

function fieldError(e: unknown, field: string): string | undefined {
  return e instanceof ApiError ? e.fieldErrors[field]?.[0] : undefined;
}

/**
 * Manajemen akun — hanya untuk Super Admin.
 *
 * Password tidak pernah ditentukan oleh pembuat akun: sistem menerbitkan
 * password sementara, menampilkannya satu kali, lalu hanya menyimpan hash-nya.
 * Pemilik akun wajib menggantinya saat login pertama, sehingga tidak ada pihak
 * lain yang tahu kredensial finalnya.
 */
export function AccountManagerPanel() {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ["admin-accounts"], queryFn: fetchAccounts, throwOnError: false });
  const { faculties } = useFaculties();

  const rows = useMemo(() => accounts.data?.data ?? [], [accounts.data]);

  const [form, setForm] = useState<NewAccountInput>({
    nidn: "", name: "", role: "kaprodi", study_program_slug: "",
  });
  const [createError, setCreateError] = useState<unknown>(null);
  /** Kredensial yang baru diterbitkan — ditampilkan sekali, tidak disimpan. */
  const [issued, setIssued] = useState<{ name: string; nidn: string; password: string } | null>(null);

  // Slug diambil dari API. Prodi tanpa slug berarti data cadangan (API belum
  // terjawab) dan tidak bisa dipakai membuat akun — lebih baik tidak muncul
  // daripada mengirim slug hasil terkaan yang akan ditolak server.
  const programOptions = useMemo(
    () => faculties.flatMap((f) => f.prodis
      .filter((p) => !!p.slug)
      .map((p) => ({ value: p.slug!, label: `${p.label} — ${f.label}` }))),
    [faculties],
  );

  const facultyOptions = faculties.map((f) => ({ value: f.slug, label: f.label }));

  const nidnValid = /^\d{10}$/.test(form.nidn);
  const scopeFilled =
    form.role === "super_admin"
    || (form.role === "kaprodi" ? !!form.study_program_slug : !!form.faculty_slug);
  const canCreate = nidnValid && form.name.trim().length >= 3 && scopeFilled;

  const create = useMutation({
    mutationFn: () => {
      const payload: NewAccountInput = { nidn: form.nidn.trim(), name: form.name.trim(), role: form.role };
      if (form.role === "kaprodi") payload.study_program_slug = form.study_program_slug;
      if (form.role === "faculty_admin") payload.faculty_slug = form.faculty_slug;
      return createAccount(payload);
    },
    onSuccess: (res) => {
      setCreateError(null);
      setIssued({
        name: res.data.account.name,
        nidn: res.data.account.nidn,
        password: res.data.temporary_password,
      });
      setForm({ nidn: "", name: "", role: "kaprodi", study_program_slug: "" });
      qc.invalidateQueries({ queryKey: ["admin-accounts"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: unknown) => setCreateError(e),
  });

  return (
    <VStack gap={4}>
      <Panel
        title="Buat akun pengelola"
        description="Sistem menerbitkan password sementara dan menampilkannya satu kali. Serahkan lewat kanal pribadi; pemilik akun wajib menggantinya saat login pertama."
      >
        <VStack gap={3}>
          <Grid columns={2} gap={3}>
            <TextInput
              label="NIDN"
              value={form.nidn}
              onChange={(v) => setForm({ ...form, nidn: v.replace(/\D/g, "").slice(0, 10) })}
              placeholder="0922038401"
              description="10 digit, sesuai PDDikti"
              status={
                fieldError(createError, "nidn")
                  ? { type: "error", message: fieldError(createError, "nidn")! }
                  : form.nidn.length > 0 && !nidnValid
                    ? { type: "error", message: "NIDN harus 10 digit angka" }
                    : undefined
              }
            />
            <TextInput
              label="Nama lengkap"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              placeholder="Dr. Nama Lengkap, M.Kom."
            />
            <Selector
              label="Peran"
              value={form.role}
              onChange={(v) => setForm({
                nidn: form.nidn, name: form.name, role: v as AdminRole,
                faculty_slug: "", study_program_slug: "",
              })}
              options={ROLE_OPTIONS}
            />
            {form.role === "kaprodi" && (
              <Selector
                label="Program studi"
                value={form.study_program_slug ?? ""}
                onChange={(v) => setForm({ ...form, study_program_slug: v })}
                options={[{ value: "", label: "— pilih program studi —" }, ...programOptions]}
                status={
                  fieldError(createError, "study_program_slug")
                    ? { type: "error", message: fieldError(createError, "study_program_slug")! }
                    : undefined
                }
              />
            )}
            {form.role === "faculty_admin" && (
              <Selector
                label="Fakultas"
                value={form.faculty_slug ?? ""}
                onChange={(v) => setForm({ ...form, faculty_slug: v })}
                options={[{ value: "", label: "— pilih fakultas —" }, ...facultyOptions]}
                status={
                  fieldError(createError, "faculty_slug")
                    ? { type: "error", message: fieldError(createError, "faculty_slug")! }
                    : undefined
                }
              />
            )}
          </Grid>

          {createError !== null && <Banner status="error">{errorMessage(createError)}</Banner>}

          <HStack>
            <Button
              label={create.isPending ? "Membuat…" : "Buat akun"}
              variant="primary"
              isLoading={create.isPending}
              isDisabled={!canCreate}
              onClick={() => create.mutate()}
            />
          </HStack>
        </VStack>
      </Panel>

      {issued && (
        <Panel>
          <VStack gap={3}>
            <Banner status="success" title="Password sementara — tampil sekali">
              <VStack gap={1}>
                <Text>{`${issued.name} · NIDN ${issued.nidn}`}</Text>
                <Code>{issued.password}</Code>
                <Text type="supporting">
                  Catat sekarang. Setelah panel ini ditutup, password tidak bisa dilihat lagi —
                  yang tersimpan hanya hash-nya. Bila hilang, lakukan reset password.
                </Text>
              </VStack>
            </Banner>
            <HStack>
              <Button label="Saya sudah mencatatnya" variant="secondary" size="sm" onClick={() => setIssued(null)} />
            </HStack>
          </VStack>
        </Panel>
      )}

      <Panel title="Daftar akun">
        <VStack gap={2}>
          {accounts.isLoading && <Text type="supporting">Memuat akun…</Text>}
          {accounts.isError && <Banner status="error">{errorMessage(accounts.error)}</Banner>}
          {rows.map((row) => (
            <AccountRow key={row.nidn} account={row} />
          ))}
        </VStack>
      </Panel>
    </VStack>
  );
}

function AccountRow({ account }: { account: AdminAccount }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState(false);

  useEffect(() => {
    if (!msg && !error) return;
    const t = setTimeout(() => { setMsg(null); setError(null); }, 5000);
    return () => clearTimeout(t);
  }, [msg, error]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-accounts"] });
    qc.invalidateQueries({ queryKey: ["admin-audit"] });
  };

  const toggleActive = useMutation({
    mutationFn: () => updateAccount(account.nidn, { is_active: !account.is_active }),
    onSuccess: (res) => { setError(null); setMsg(res.message ?? "Tersimpan."); setConfirmToggle(false); invalidate(); },
    onError: (e: unknown) => { setMsg(null); setError(e); setConfirmToggle(false); },
  });

  const reset = useMutation({
    mutationFn: () => resetAccountPassword(account.nidn),
    onSuccess: (res) => { setError(null); setIssued(res.data.temporary_password); invalidate(); },
    onError: (e: unknown) => setError(e),
  });

  const scope = account.role === "super_admin"
    ? "Seluruh universitas"
    : account.study_program_label ?? account.faculty_label ?? "—";

  return (
    <Panel padding={3}>
      <VStack gap={2}>
        <HStack justify="between" align="start" gap={2} wrap="wrap">
          <VStack gap={0}>
            <Text weight="semibold">{account.name}</Text>
            <Text type="supporting">{`NIDN ${account.nidn} · ${scope}`}</Text>
          </VStack>
          <HStack align="center" gap={1} wrap="wrap">
            <Badge variant={account.role === "super_admin" ? "success" : "default"}>
              {ROLE_LABEL[account.role]}
            </Badge>
            {!account.is_active && <Badge variant="danger">Nonaktif</Badge>}
            {account.is_locked && <Badge variant="warning">Terkunci</Badge>}
            {account.must_change_password && <Badge variant="warning">Belum ganti password</Badge>}
          </HStack>
        </HStack>

        {issued && (
          <Banner status="success" title="Password sementara — tampil sekali">
            <Code>{issued}</Code>
          </Banner>
        )}
        {msg && <Banner status="success">{msg}</Banner>}
        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        <HStack gap={2} wrap="wrap">
          <Button
            label={reset.isPending ? "Mereset…" : "Reset password"}
            variant="secondary"
            size="sm"
            isLoading={reset.isPending}
            onClick={() => reset.mutate()}
          />
          {confirmToggle ? (
            <>
              <Button
                label={account.is_active ? "Ya, nonaktifkan" : "Ya, aktifkan"}
                variant={account.is_active ? "destructive" : "primary"}
                size="sm"
                isLoading={toggleActive.isPending}
                onClick={() => toggleActive.mutate()}
              />
              <Button label="Batal" variant="ghost" size="sm" onClick={() => setConfirmToggle(false)} />
            </>
          ) : (
            <Button
              label={account.is_active ? "Nonaktifkan" : "Aktifkan"}
              variant="ghost"
              size="sm"
              onClick={() => setConfirmToggle(true)}
            />
          )}
        </HStack>
      </VStack>
    </Panel>
  );
}
