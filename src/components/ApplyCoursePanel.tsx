import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { ApiError } from "@/lib/api";
import { applyCourseToDraft, fetchPublicCourses } from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Card } from "./ui/Card";

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const first = Object.values(e.fieldErrors)[0]?.[0];
    if (first) return first;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Mengisi draft dari bank kurikulum program studi.
 *
 * Sumbernya mata kuliah yang sudah disahkan prodi, jadi CPL/CPMK/Sub-CPMK di
 * dokumen konsisten dengan kurikulum — berbeda dari tombol "Isi CONTOH" yang
 * hanya menyalin contoh Biomedik, dan dari hasil AI yang perlu diperiksa.
 */
export function ApplyCoursePanel({
  draftId, studyProgram, onApplied,
}: {
  draftId: number;
  studyProgram: string | null;
  onApplied: () => void;
}) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const courses = useQuery({
    queryKey: ["public-courses", studyProgram],
    queryFn: () => fetchPublicCourses(studyProgram!),
    enabled: !!studyProgram,
    throwOnError: false,
  });

  const rows = useMemo(() => courses.data?.data ?? [], [courses.data]);
  const selected = rows.find((c) => String(c.id) === selectedId) ?? null;

  const apply = useMutation({
    mutationFn: () => applyCourseToDraft(draftId, Number(selectedId)),
    onSuccess: (res) => {
      setError(null);
      const n = res.data.applied;
      setMsg(`${res.data.course_code} diterapkan: ${n.cpl} CPL, ${n.cpmk} CPMK, ${n.sub_cpmk} Sub-CPMK.`);
      qc.invalidateQueries({ queryKey: ["rps", draftId] });
      onApplied();
    },
    onError: (e: unknown) => { setMsg(null); setError(e); },
  });

  if (!studyProgram) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Text weight="semibold">Isi dari kurikulum prodi</Text>
          <Text type="supporting">
            Ambil identitas MK, deskripsi, pustaka, dan CPL/CPMK/Sub-CPMK dari bank kurikulum
            {studyProgram ? ` ${studyProgram}` : ""}.
          </Text>
        </div>
        {rows.length > 0 && <Badge variant="default">{rows.length} MK tersedia</Badge>}
      </div>

      {courses.isLoading && <div className="mt-2"><Text type="supporting">Memuat kurikulum…</Text></div>}

      {!courses.isLoading && rows.length === 0 && (
        <div className="mt-3">
          <Banner status="info">
            Bank kurikulum {studyProgram} masih kosong. Admin prodi bisa menyusunnya di
            Admin → Kurikulum &amp; CPMK, setelah itu RPS bisa diisi otomatis dari sana.
          </Banner>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 grid gap-3">
          <Selector
            label="Mata kuliah"
            value={selectedId}
            onChange={setSelectedId}
            options={[
              { value: "", label: "— pilih mata kuliah —" },
              ...rows.map((c) => ({
                value: String(c.id),
                label: `${c.code} — ${c.name} (sem ${c.semester}, ${c.cpmk_count} CPMK)`,
              })),
            ]}
          />

          {selected && selected.cpmk_count === 0 && (
            <Banner status="warning">
              {selected.code} belum punya CPMK di bank kurikulum. Bagian CP pada dokumen akan kosong.
            </Banner>
          )}

          {msg && <Banner status="success">{msg}</Banner>}
          {error !== null && <Banner status="error">{errorMessage(error)}</Banner>}

          <div>
            <Button
              label={apply.isPending ? "Menerapkan…" : "Terapkan ke draft ini"}
              variant="primary"
              size="sm"
              isLoading={apply.isPending}
              isDisabled={!selectedId}
              onClick={() => apply.mutate()}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
