import { useQuery } from "@tanstack/react-query";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { fetchProgramMatrix, type AdminProgram } from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Panel } from "./ui/Panel";
import { DataTable } from "./ui/DataTable";

const CATEGORY_LABEL: Record<string, string> = {
  sikap: "Sikap",
  pengetahuan: "Pengetahuan",
  keterampilan_umum: "Keterampilan Umum",
  keterampilan_khusus: "Keterampilan Khusus",
};

/**
 * Matriks pemetaan CPL × Profil Lulusan × CPMK.
 *
 * Gunanya bukan sekadar menampilkan data: tabel ini menunjukkan CPL mana yang
 * belum ditopang mata kuliah apa pun, dan CPMK mana yang menggantung tanpa CPL.
 * Dua hal itulah yang pertama ditanya asesor.
 */
export function MatrixPanel({ program }: { program: AdminProgram }) {
  const matrix = useQuery({
    queryKey: ["admin-matrix", program.slug],
    queryFn: () => fetchProgramMatrix(program.slug),
    throwOnError: false,
  });

  const data = matrix.data?.data;

  if (matrix.isLoading) return <Text type="supporting">Menyusun matriks…</Text>;
  if (matrix.isError || !data) return <Banner status="error">Gagal memuat matriks.</Banner>;

  return (
    <VStack gap={4}>
      <Panel
        title={`Matriks CPL — ${data.study_program.label}`}
        description={
          `${data.cpl.length} CPL · ${data.course_count} mata kuliah · ${data.cpmk_count} CPMK · ` +
          `${data.graduate_profile.length} profil lulusan`
        }
        actions={
          <Badge variant={data.uncovered_cpl.length === 0 ? "success" : "warning"}>
            {data.uncovered_cpl.length === 0
              ? "Semua CPL ditopang"
              : `${data.uncovered_cpl.length} CPL belum ditopang`}
          </Badge>
        }
      >
        <VStack gap={2}>
          {data.cpl.length === 0 && (
            <Banner status="warning">
              Prodi ini belum punya CPL. Isi tab CPL Prodi lebih dulu — tanpa CPL, matriks tidak
              bisa disusun.
            </Banner>
          )}
          {data.uncovered_cpl.length > 0 && (
            <Banner status="warning" title="CPL belum ditopang mata kuliah">
              {`${data.uncovered_cpl.join(", ")} belum punya CPMK yang memetakan ke sana. Tambahkan CPMK di tab Kurikulum, atau tinjau ulang rumusan CPL-nya.`}
            </Banner>
          )}
          {data.orphan_cpmk.length > 0 && (
            <Banner status="warning" title="CPMK belum dipetakan ke CPL">
              <List density="compact">
                {data.orphan_cpmk.map((o) => (
                  <ListItem
                    key={`${o.course_code}-${o.cpmk_code}`}
                    label={
                      `${o.course_code} · ${o.cpmk_code}` +
                      (o.cpl_code ? ` menunjuk ${o.cpl_code} yang tidak ada` : " belum menunjuk CPL")
                    }
                  />
                ))}
              </List>
            </Banner>
          )}
        </VStack>
      </Panel>

      {data.cpl.map((cpl) => (
        <Panel
          key={cpl.code}
          title={cpl.code}
          description={cpl.description}
          actions={
            <HStack align="center" gap={1} wrap="wrap">
              {cpl.category && <Badge variant="default">{CATEGORY_LABEL[cpl.category] ?? cpl.category}</Badge>}
              <Badge variant={cpl.is_covered ? "success" : "warning"}>
                {cpl.is_covered ? `${cpl.supporting.length} CPMK` : "belum ditopang"}
              </Badge>
            </HStack>
          }
        >
          {cpl.supporting.length > 0 && (
            <DataTable
              minWidth={560}
              rows={cpl.supporting}
              rowKey={(s) => `${s.course_code}-${s.cpmk_code}`}
              columns={[
                { header: "Mata kuliah", cell: (s) => <span className="font-mono">{s.course_code}</span> },
                { header: "Smt", cell: (s) => s.semester, align: "center", width: 60 },
                {
                  header: "CPMK",
                  cell: (s) => `${s.cpmk_code}${s.taxonomy ? ` (${s.taxonomy})` : ""}`,
                },
                {
                  header: "Rumusan",
                  cell: (s) => <span className="text-secondary">{s.cpmk_description}</span>,
                },
                { header: "Sub", cell: (s) => s.sub_cpmk_count, align: "center", width: 60 },
              ]}
            />
          )}
        </Panel>
      ))}

      {data.graduate_profile.length > 0 && (
        <Panel
          title="Profil lulusan"
          description="CPL di atas adalah penjabaran profil lulusan berikut."
        >
          <List density="compact">
            {data.graduate_profile.map((profile) => (
              <ListItem key={profile} label={profile} />
            ))}
          </List>
        </Panel>
      )}
    </VStack>
  );
}
