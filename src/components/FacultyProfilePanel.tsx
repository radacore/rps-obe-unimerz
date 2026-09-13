import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { ApiError } from "@/lib/api";
import { fetchAdminFaculties, updateFacultyProfile, type AdminFaculty } from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Card } from "./ui/Card";
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
    <div className="grid gap-4">
      {rows.length > 1 && (
        <Card>
          <Text weight="semibold">Profil fakultas</Text>
          <Text type="supporting">{rows.length} fakultas dalam wewenang Anda</Text>
          <div className="mt-3 max-w-xl">
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
        </Card>
      )}
      {selected && <FacultyForm key={selected.slug} faculty={selected} />}
    </div>
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
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Text weight="semibold">{faculty.label}</Text>
          <Text type="supporting">
            {faculty.program_count} program studi
            {faculty.href ? ` · ${faculty.href}` : ""}
          </Text>
        </div>
        {dirty && <Badge variant="warning">Belum disimpan</Badge>}
      </div>

      {isEmpty && (
        <div className="mt-2">
          <Banner status="info">
            Visi dan misi fakultas belum pernah diisi. Data ini tidak tersedia dari hasil penelusuran
            situs, jadi perlu dimasukkan dari dokumen resmi fakultas.
          </Banner>
        </div>
      )}

      <div className="mt-4 grid gap-4">
        <div className="grid gap-1">
          <Text weight="semibold">Visi</Text>
          <textarea
            className="min-h-[80px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-primary placeholder:text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            rows={3}
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            placeholder="Menjadi fakultas …"
          />
        </div>

        <LinesEditor label="Misi" hint="Satu misi per baris" value={mission} onChange={setMission} />
        <LinesEditor label="Tujuan" hint="Satu tujuan per baris" value={objective} onChange={setObjective} />

        {msg && <Banner status="success">{msg}</Banner>}
        {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>
    </Card>
  );
}
