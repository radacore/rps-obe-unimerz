import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { ApiError } from "@/lib/api";
import { fetchAdminFaculties, updateFacultyProfile, type AdminFaculty } from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Panel } from "./ui/Panel";
import { Textarea } from "./ui/Textarea";
import { LinesEditor } from "./ui/LinesEditor";

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Object.values(e.fieldErrors)[0]?.[0];
    if (first) return first;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Panel visi/misi/tujuan fakultas. */
export function FacultyProfilePanel({ enabled }: { enabled: boolean }) {
  const faculties = useQuery({
    queryKey: ["admin-faculties"],
    queryFn: fetchAdminFaculties,
    enabled,
    throwOnError: false,
  });

  const rows = useMemo(() => faculties.data?.data ?? [], [faculties.data]);
  const [pickedSlug, setPickedSlug] = useState<string | null>(null);
  const selected = rows.find((f) => f.slug === pickedSlug) ?? rows[0] ?? null;

  if (faculties.isLoading) return <Text type="supporting">Memuat fakultas…</Text>;
  if (faculties.isError) return <Banner status="error">{errorMessage(faculties.error)}</Banner>;
  if (!rows.length) return null;

  return (
    <VStack gap={4}>
      {rows.length > 1 && (
        <Panel
          title="Profil fakultas"
          description={`${rows.length} fakultas dalam wewenang Anda`}
        >
          <div style={{ maxWidth: 640 }}>
            <Selector
              label="Pilih fakultas"
              value={selected?.slug ?? ""}
              onChange={(v) => setPickedSlug(v)}
              options={rows.map((f) => ({
                value: f.slug,
                label: `${f.label} (${f.program_count} prodi)`,
              }))}
            />
          </div>
        </Panel>
      )}
      {selected && <FacultyForm key={selected.slug} faculty={selected} />}
    </VStack>
  );
}

function FacultyForm({ faculty }: { faculty: AdminFaculty }) {
  const qc = useQueryClient();
  const [vision, setVision] = useState(faculty.vision ?? "");
  const [mission, setMission] = useState<string[]>(faculty.mission);
  const [objective, setObjective] = useState<string[]>(faculty.objective);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const [baseline, setBaseline] = useState({
    vision: faculty.vision ?? "",
    mission: faculty.mission,
    objective: faculty.objective,
  });

  useEffect(() => {
    if (!msg && !error) return;
    const t = setTimeout(() => { setMsg(null); setError(null); }, 4000);
    return () => clearTimeout(t);
  }, [msg, error]);

  const dirty =
    vision !== baseline.vision
    || JSON.stringify(mission) !== JSON.stringify(baseline.mission)
    || JSON.stringify(objective) !== JSON.stringify(baseline.objective);

  const save = useMutation({
    mutationFn: () => updateFacultyProfile(faculty.slug, {
      vision: vision.trim() ? vision.trim() : null,
      mission,
      objective,
    }),
    onSuccess: (res) => {
      setError(null);
      setMsg(res.message ?? "Tersimpan.");
      setBaseline({
        vision: res.data.vision ?? "",
        mission: res.data.mission,
        objective: res.data.objective,
      });
      setVision(res.data.vision ?? "");
      setMission(res.data.mission);
      setObjective(res.data.objective);
      qc.invalidateQueries({ queryKey: ["admin-faculties"] });
      qc.invalidateQueries({ queryKey: ["faculties"] });
    },
    onError: (e: unknown) => { setMsg(null); setError(e); },
  });

  const isEmpty = !faculty.vision && faculty.mission.length === 0;

  return (
    <Panel
      title={faculty.label}
      description={`${faculty.program_count} program studi${faculty.href ? ` · ${faculty.href}` : ""}`}
      actions={dirty ? <Badge variant="warning">Belum disimpan</Badge> : undefined}
    >
      <VStack gap={4}>
        {isEmpty && (
          <Banner status="info">
            Visi dan misi fakultas belum pernah diisi. Data ini tidak tersedia dari hasil penelusuran
            situs, jadi perlu dimasukkan dari dokumen resmi fakultas.
          </Banner>
        )}

        <Textarea
          label="Visi"
          value={vision}
          onChange={setVision}
          placeholder="Menjadi fakultas …"
          minRows={3}
        />

        <LinesEditor label="Misi" hint="Satu misi per baris" value={mission} onChange={setMission} />
        <LinesEditor label="Tujuan" hint="Satu tujuan per baris" value={objective} onChange={setObjective} />

        {msg && <Banner status="success">{msg}</Banner>}
        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        <HStack gap={2}>
          <Button
            label={save.isPending ? "Menyimpan…" : "Simpan profil fakultas"}
            variant="primary"
            isLoading={save.isPending}
            isDisabled={!dirty}
            onClick={() => save.mutate()}
          />
          <Button
            label="Batalkan perubahan"
            variant="secondary"
            isDisabled={!dirty}
            onClick={() => {
              setVision(baseline.vision);
              setMission(baseline.mission);
              setObjective(baseline.objective);
            }}
          />
        </HStack>
      </VStack>
    </Panel>
  );
}
