import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { SegmentedControl } from "@astryxdesign/core/SegmentedControl";
import { SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { ApiError } from "@/lib/api";
import {
  ADMIN_SESSION_KEY, adminLogout, fetchAdminSession, fetchAdminPrograms, updateProgramProfile,
  ROLE_LABEL, type AdminProgram,
} from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Panel } from "./ui/Panel";
import { Textarea } from "./ui/Textarea";
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

/**
 * Halaman admin: identitas pengelola + tab-tab master data.
 *
 * Tab dulu memakai tombol Astryx berjejer — sekarang `SegmentedControl` supaya
 * satu grup jelas terlihat, dengan peran yang dipilih ditonjolkan. Kartu
 * profil pengelola & profil prodi memakai wrapper `Panel` agar spacing sama
 * dengan halaman lain.
 */
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

  type TabId = "fakultas" | "prodi" | "cpl" | "kurikulum" | "matriks" | "akun" | "riwayat";
  const [tab, setTab] = useState<TabId>("prodi");

  if (session.isLoading) return <Text type="supporting">Memuat sesi…</Text>;
  if (!identity) return <AdminLoginForm />;
  if (identity.mustChangePassword) return <ForcedPasswordChange name={identity.name} />;

  // Tab disesuaikan peran supaya pengguna tidak diarahkan ke aksi yang pasti
  // ditolak: dosen tidak mengelola master data, kaprodi tidak menyentuh profil
  // fakultas, akun hanya untuk super admin. Penyembunyian ini demi kejelasan —
  // server tetap yang menegakkan wewenangnya.
  const isDosen = identity.role === "dosen";
  const TABS: { id: TabId; label: string }[] = isDosen
    ? [{ id: "riwayat", label: "Riwayat" }]
    : [
      ...(identity.role === "kaprodi" ? [] : [{ id: "fakultas" as const, label: "Profil Fakultas" }]),
      { id: "prodi", label: "Profil Prodi" },
      { id: "cpl", label: "CPL Prodi" },
      { id: "kurikulum", label: "Kurikulum & CPMK" },
      { id: "matriks", label: "Matriks CPL" },
      ...(identity.role === "super_admin" ? [{ id: "akun" as const, label: "Akun Pengelola" }] : []),
      { id: "riwayat", label: "Riwayat" },
    ];
  const activeTab: TabId = TABS.some((t) => t.id === tab) ? tab : TABS[0].id;

  return (
    <VStack gap={4}>
      <Panel>
        <HStack justify="between" align="center" gap={3} wrap="wrap">
          <VStack gap={0}>
            <Text weight="semibold">{identity.name}</Text>
            <Text type="supporting">
              NIDN {identity.nidn} · {ROLE_LABEL[identity.role]}
              {identity.facultyLabel ? ` · ${identity.facultyLabel}` : " · seluruh fakultas"}
            </Text>
          </VStack>
          <HStack align="center" gap={2}>
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
          </HStack>
        </HStack>
      </Panel>

      {isDosen && (
        <Banner status="info" title="Peran Dosen">
          Anda menulis RPS, bukan mengelola master data. Buka daftar RPS di menu Drafts;
          perubahan visi, CPL, atau kurikulum dilakukan Kaprodi dan Admin Fakultas.
        </Banner>
      )}

      {TABS.length > 1 && (
        <SegmentedControl
          label="Bagian master data"
          value={activeTab}
          onChange={(v) => setTab(v as TabId)}
        >
          {TABS.map((t) => (
            <SegmentedControlItem key={t.id} value={t.id} label={t.label} />
          ))}
        </SegmentedControl>
      )}

      {activeTab === "fakultas" && <FacultyProfilePanel enabled={!identity.mustChangePassword} />}
      {activeTab === "akun" && <AccountManagerPanel />}
      {activeTab === "riwayat" && <AuditLogPanel enabled={!identity.mustChangePassword} />}

      {(activeTab === "prodi" || activeTab === "cpl" || activeTab === "kurikulum" || activeTab === "matriks") && (
        <>
          {programs.isLoading && <Text type="supporting">Memuat daftar program studi…</Text>}
          {programs.isError && <Banner status="error">{errorMessage(programs.error)}</Banner>}

          {rows.length > 0 && (
            <Panel
              title="Program studi dalam wewenang Anda"
              description={
                `${rows.length} program studi` +
                (identity.role === "kaprodi"
                  ? ` — ${identity.studyProgramLabel ?? "prodi Anda"}`
                  : identity.role === "faculty_admin"
                    ? ` di ${identity.facultyLabel}`
                    : " di seluruh universitas")
              }
            >
              <div style={{ maxWidth: 640 }}>
                <Selector
                  label="Pilih program studi"
                  value={selectedSlug}
                  onChange={(v) => setPickedSlug(v)}
                  options={rows.map((r) => ({ value: r.slug, label: `${r.label} — ${r.faculty_label}` }))}
                />
              </div>
            </Panel>
          )}

          {rows.length === 0 && !programs.isLoading && !programs.isError && (
            <Panel>
              <Text type="supporting">
                Belum ada program studi yang bisa Anda kelola. Hubungi pengelola sistem bila ini tidak sesuai.
              </Text>
            </Panel>
          )}

          {selected && activeTab === "prodi" && <ProgramProfileForm key={selected.slug} program={selected} />}
          {selected && activeTab === "cpl" && (
            <CplEditor key={`cpl-${selected.slug}`} slug={selected.slug} label={selected.label} initialCpl={selected.cpl} />
          )}
          {selected && activeTab === "kurikulum" && <CurriculumPanel key={`kur-${selected.slug}`} program={selected} />}
          {selected && activeTab === "matriks" && <MatrixPanel key={`mtx-${selected.slug}`} program={selected} />}
        </>
      )}
    </VStack>
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
    <Panel
      title={program.label}
      description={`${program.faculty_label} · Akreditasi ${program.akreditasi ?? "—"} · sumber data ${program.completeness}`}
      actions={dirty ? <Badge variant="warning">Belum disimpan</Badge> : undefined}
    >
      <VStack gap={4}>
        <Text type="supporting">
          Isi di sini yang dipakai halaman sampul RPS: Visi, Misi, dan Profil Lulusan program studi.
        </Text>

        <Textarea
          label="Visi"
          value={vision}
          onChange={setVision}
          placeholder="Menjadi program studi …"
          minRows={3}
        />

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

        <HStack gap={2}>
          <Button
            label={save.isPending ? "Menyimpan…" : "Simpan profil"}
            variant="primary"
            isLoading={save.isPending}
            isDisabled={!dirty}
            onClick={() => save.mutate()}
          />
          <Button label="Batalkan perubahan" variant="secondary" isDisabled={!dirty} onClick={reset} />
        </HStack>
      </VStack>
    </Panel>
  );
}

// Heading tidak dipakai lagi tapi dibiarkan diimpor tersedia untuk perubahan
// kecil selanjutnya (mis. tambah sub-heading di dalam Panel).
void Heading;
