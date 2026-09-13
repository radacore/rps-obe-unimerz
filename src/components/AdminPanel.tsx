import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { ApiError } from "@/lib/api";
import {
  ADMIN_SESSION_KEY, adminLogout, fetchAdminSession, fetchAdminPrograms, updateProgramProfile,
  ROLE_LABEL, type AdminProgram,
} from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Card } from "./ui/Card";
import { LinesEditor } from "./ui/LinesEditor";
import { AdminLoginForm, ForcedPasswordChange } from "./AdminLoginForm";
import { CplEditor } from "./CplEditor";
import { FacultyProfilePanel } from "./FacultyProfilePanel";
import { AccountManagerPanel } from "./AccountManagerPanel";
import { AuditLogPanel } from "./AuditLogPanel";
import { CurriculumPanel } from "./CurriculumPanel";
import { MatrixPanel } from "./MatrixPanel";

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Object.entries(e.fieldErrors)[0];
    if (first) return `${first[0]}: ${first[1][0]}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export function AdminPanel() {
  const qc = useQueryClient();

  const session = useQuery({ queryKey: ADMIN_SESSION_KEY, queryFn: fetchAdminSession, retry: false });
  const identity = session.data ?? null;

  const programs = useQuery({
    queryKey: ["admin-programs"],
    queryFn: fetchAdminPrograms,
    enabled: !!identity && !identity.mustChangePassword,
    throwOnError: false,
  });

  const rows = useMemo(() => programs.data?.data ?? [], [programs.data]);
  const [pickedSlug, setPickedSlug] = useState<string | null>(null);

  // Pilihan diturunkan saat render, bukan lewat efek: kalau prodi yang dipilih
  // tidak ada di daftar (mis. setelah berganti akun), jatuh ke prodi pertama.
  const selected = rows.find((r) => r.slug === pickedSlug) ?? rows[0] ?? null;
  const selectedSlug = selected?.slug ?? "";

  const logout = useMutation({
    mutationFn: adminLogout,
    onSuccess: () => {
      qc.setQueryData(ADMIN_SESSION_KEY, null);
      qc.removeQueries({ queryKey: ["admin-programs"] });
      qc.removeQueries({ queryKey: ["admin-faculties"] });
      qc.removeQueries({ queryKey: ["admin-accounts"] });
      qc.removeQueries({ queryKey: ["admin-audit"] });
      qc.removeQueries({ queryKey: ["admin-courses"] });
      qc.removeQueries({ queryKey: ["admin-matrix"] });
    },
  });

  const [tab, setTab] = useState<"fakultas" | "prodi" | "cpl" | "kurikulum" | "matriks" | "akun" | "riwayat">("prodi");

  if (session.isLoading) return <Text type="supporting">Memuat sesi…</Text>;
  if (!identity) return <AdminLoginForm />;
  if (identity.mustChangePassword) return <ForcedPasswordChange name={identity.name} />;

  // Kaprodi tidak berwenang atas profil fakultas, jadi tab itu disembunyikan;
  // manajemen akun hanya untuk super admin. Penyembunyian ini demi kejelasan —
  // server tetap yang menegakkan wewenangnya.
  const TABS: { id: typeof tab; label: string }[] = [
    ...(identity.role === "kaprodi" ? [] : [{ id: "fakultas" as const, label: "Profil Fakultas" }]),
    { id: "prodi", label: "Profil Prodi" },
    { id: "cpl", label: "CPL Prodi" },
    { id: "kurikulum", label: "Kurikulum & CPMK" },
    { id: "matriks", label: "Matriks CPL" },
    ...(identity.role === "super_admin" ? [{ id: "akun" as const, label: "Akun Pengelola" }] : []),
    { id: "riwayat", label: "Riwayat" },
  ];

  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Text weight="semibold">{identity.name}</Text>
          <Text type="supporting">
            NIDN {identity.nidn} · {ROLE_LABEL[identity.role]}
            {identity.facultyLabel ? ` · ${identity.facultyLabel}` : " · seluruh fakultas"}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={identity.role === "super_admin" ? "success" : "default"}>
            {ROLE_LABEL[identity.role]}
          </Badge>
          <Button
            label={logout.isPending ? "Keluar…" : "Keluar"}
            variant="secondary"
            size="sm"
            isLoading={logout.isPending}
            onClick={() => logout.mutate()}
          />
        </div>
      </Card>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Bagian master data">
        {TABS.map((t) => (
          <Button
            key={t.id}
            label={t.label}
            variant={tab === t.id ? "primary" : "secondary"}
            size="sm"
            onClick={() => setTab(t.id)}
          />
        ))}
      </div>

      {tab === "fakultas" && <FacultyProfilePanel enabled={!identity.mustChangePassword} />}
      {tab === "akun" && <AccountManagerPanel />}
      {tab === "riwayat" && <AuditLogPanel enabled={!identity.mustChangePassword} />}

      {(tab === "prodi" || tab === "cpl" || tab === "kurikulum" || tab === "matriks") && (
        <>
          {programs.isLoading && <Text type="supporting">Memuat daftar program studi…</Text>}
          {programs.isError && <Banner status="error">{errorMessage(programs.error)}</Banner>}

          {rows.length > 0 && (
            <Card>
              <Text weight="semibold">Program studi dalam wewenang Anda</Text>
              <Text type="supporting">
                {rows.length} program studi
                {identity.role === "kaprodi"
                  ? ` — ${identity.studyProgramLabel ?? "prodi Anda"}`
                  : identity.role === "faculty_admin"
                    ? ` di ${identity.facultyLabel}`
                    : " di seluruh universitas"}
              </Text>
              <div className="mt-3 max-w-xl">
                <Selector
                  label="Pilih program studi"
                  value={selectedSlug}
                  onChange={(v) => setPickedSlug(v)}
                  options={rows.map((r) => ({ value: r.slug, label: `${r.label} — ${r.faculty_label}` }))}
                />
              </div>
            </Card>
          )}

          {rows.length === 0 && !programs.isLoading && !programs.isError && (
            <Card>
              <Text type="supporting">
                Belum ada program studi yang bisa Anda kelola. Hubungi pengelola sistem bila ini tidak sesuai.
              </Text>
            </Card>
          )}

          {selected && tab === "prodi" && <ProgramProfileForm key={selected.slug} program={selected} />}
          {selected && tab === "cpl" && (
            <CplEditor key={`cpl-${selected.slug}`} slug={selected.slug} label={selected.label} initialCpl={selected.cpl} />
          )}
          {selected && tab === "kurikulum" && <CurriculumPanel key={`kur-${selected.slug}`} program={selected} />}
          {selected && tab === "matriks" && <MatrixPanel key={`mtx-${selected.slug}`} program={selected} />}
        </>
      )}
    </div>
  );
}

function ProgramProfileForm({ program }: { program: AdminProgram }) {
  const qc = useQueryClient();

  const [vision, setVision] = useState(program.vision ?? "");
  const [mission, setMission] = useState<string[]>(program.mission);
  const [objective, setObjective] = useState<string[]>(program.objective);
  const [graduateProfile, setGraduateProfile] = useState<string[]>(program.graduate_profile);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Nilai acuan untuk mendeteksi perubahan. Diperbarui dari respons simpan,
  // bukan dari efek: menyelaraskan lewat useEffect akan menimpa editan
  // pengguna setiap kali query ini di-refetch di latar belakang.
  const [baseline, setBaseline] = useState({
    vision: program.vision ?? "",
    mission: program.mission,
    objective: program.objective,
    graduateProfile: program.graduate_profile,
  });

  useEffect(() => {
    if (!msg && !error) return;
    const t = setTimeout(() => { setMsg(null); setError(null); }, 4000);
    return () => clearTimeout(t);
  }, [msg, error]);

  const dirty =
    vision !== baseline.vision
    || JSON.stringify(mission) !== JSON.stringify(baseline.mission)
    || JSON.stringify(objective) !== JSON.stringify(baseline.objective)
    || JSON.stringify(graduateProfile) !== JSON.stringify(baseline.graduateProfile);

  const save = useMutation({
    mutationFn: () => updateProgramProfile(program.slug, {
      vision: vision.trim() ? vision.trim() : null,
      mission,
      objective,
      graduate_profile: graduateProfile,
    }),
    onSuccess: (res) => {
      setError(null);
      setMsg(res.message ?? "Tersimpan.");
      // Pakai bentuk yang benar-benar tersimpan di server sebagai acuan baru.
      setBaseline({
        vision: res.data.vision ?? "",
        mission: res.data.mission,
        objective: res.data.objective,
        graduateProfile: res.data.graduate_profile,
      });
      setVision(res.data.vision ?? "");
      setMission(res.data.mission);
      setObjective(res.data.objective);
      setGraduateProfile(res.data.graduate_profile);
      qc.invalidateQueries({ queryKey: ["admin-programs"] });
      // Form RPS membaca profil prodi lewat endpoint publik; buang cache-nya
      // supaya perubahan langsung terlihat di sana.
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["faculties"] });
    },
    onError: (e: unknown) => { setMsg(null); setError(e); },
  });

  const reset = () => {
    setVision(baseline.vision);
    setMission(baseline.mission);
    setObjective(baseline.objective);
    setGraduateProfile(baseline.graduateProfile);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Text weight="semibold">{program.label}</Text>
          <Text type="supporting">
            {program.faculty_label} · Akreditasi {program.akreditasi ?? "—"} · sumber data {program.completeness}
          </Text>
        </div>
        {dirty && <Badge variant="warning">Belum disimpan</Badge>}
      </div>

      <Text type="supporting">
        Isi di sini yang dipakai halaman sampul RPS: Visi, Misi, dan Profil Lulusan program studi.
      </Text>

      <div className="mt-4 grid gap-4">
        <div className="grid gap-1">
          <Text weight="semibold">Visi</Text>
          <textarea
            className="min-h-[80px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-primary placeholder:text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            rows={3}
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            placeholder="Menjadi program studi …"
          />
        </div>

        <LinesEditor label="Misi" hint="Satu misi per baris" value={mission} onChange={setMission} />
        <LinesEditor label="Tujuan" hint="Satu tujuan per baris" value={objective} onChange={setObjective} />
        <LinesEditor
          label="Profil lulusan"
          hint="Satu profil per baris — tercetak sebagai daftar bernomor di sampul RPS"
          value={graduateProfile}
          onChange={setGraduateProfile}
        />

        {msg && <Banner status="success">{msg}</Banner>}
        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        <div className="flex flex-wrap gap-2">
          <Button
            label={save.isPending ? "Menyimpan…" : "Simpan profil"}
            variant="primary"
            isLoading={save.isPending}
            isDisabled={!dirty}
            onClick={() => save.mutate()}
          />
          <Button label="Batalkan perubahan" variant="secondary" isDisabled={!dirty} onClick={reset} />
        </div>
      </div>
    </Card>
  );
}
