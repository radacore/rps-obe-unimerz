import { useQuery } from "@tanstack/react-query";
import { Text } from "@astryxdesign/core/Text";
import { fetchProgramMatrix, type AdminProgram } from "@/lib/admin";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Card } from "./ui/Card";

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
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <Text weight="semibold">Matriks CPL — {data.study_program.label}</Text>
            <Text type="supporting">
              {data.cpl.length} CPL · {data.course_count} mata kuliah · {data.cpmk_count} CPMK ·
              {" "}{data.graduate_profile.length} profil lulusan
            </Text>
          </div>
          <Badge variant={data.uncovered_cpl.length === 0 ? "success" : "warning"}>
            {data.uncovered_cpl.length === 0
              ? "Semua CPL ditopang"
              : `${data.uncovered_cpl.length} CPL belum ditopang`}
          </Badge>
        </div>

        {data.cpl.length === 0 && (
          <div className="mt-3">
            <Banner status="warning">
              Prodi ini belum punya CPL. Isi tab CPL Prodi lebih dulu — tanpa CPL, matriks tidak bisa disusun.
            </Banner>
          </div>
        )}

        {data.uncovered_cpl.length > 0 && (
          <div className="mt-3">
            <Banner status="warning" title="CPL belum ditopang mata kuliah">
              {data.uncovered_cpl.join(", ")} belum punya CPMK yang memetakan ke sana. Tambahkan CPMK
              di tab Kurikulum, atau tinjau ulang rumusan CPL-nya.
            </Banner>
          </div>
        )}

        {data.orphan_cpmk.length > 0 && (
          <div className="mt-3">
            <Banner status="warning" title="CPMK belum dipetakan ke CPL">
              <ul className="grid gap-1">
                {data.orphan_cpmk.map((o) => (
                  <li key={`${o.course_code}-${o.cpmk_code}`} className="text-xs">
                    {o.course_code} · {o.cpmk_code}
                    {o.cpl_code ? ` menunjuk ${o.cpl_code} yang tidak ada` : " belum menunjuk CPL"}
                  </li>
                ))}
              </ul>
            </Banner>
          </div>
        )}
      </Card>

      {data.cpl.map((cpl) => (
        <Card key={cpl.code}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Text weight="semibold">{cpl.code}</Text>
              <Text type="supporting">{cpl.description}</Text>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {cpl.category && <Badge variant="default">{CATEGORY_LABEL[cpl.category] ?? cpl.category}</Badge>}
              <Badge variant={cpl.is_covered ? "success" : "warning"}>
                {cpl.is_covered ? `${cpl.supporting.length} CPMK` : "belum ditopang"}
              </Badge>
            </div>
          </div>

          {cpl.supporting.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium text-secondary">Mata kuliah</th>
                    <th className="py-2 pr-3 font-medium text-secondary">Smt</th>
                    <th className="py-2 pr-3 font-medium text-secondary">CPMK</th>
                    <th className="py-2 pr-3 font-medium text-secondary">Rumusan</th>
                    <th className="py-2 font-medium text-secondary">Sub</th>
                  </tr>
                </thead>
                <tbody>
                  {cpl.supporting.map((s) => (
                    <tr key={`${s.course_code}-${s.cpmk_code}`} className="border-b border-border/60 align-top">
                      <td className="py-2 pr-3 font-mono">{s.course_code}</td>
                      <td className="py-2 pr-3">{s.semester}</td>
                      <td className="py-2 pr-3">
                        {s.cpmk_code}
                        {s.taxonomy ? ` (${s.taxonomy})` : ""}
                      </td>
                      <td className="py-2 pr-3 leading-relaxed text-secondary">{s.cpmk_description}</td>
                      <td className="py-2">{s.sub_cpmk_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}

      {data.graduate_profile.length > 0 && (
        <Card>
          <Text weight="semibold">Profil lulusan</Text>
          <Text type="supporting">
            CPL di atas adalah penjabaran profil lulusan berikut.
          </Text>
          <ol className="mt-2 grid list-decimal gap-1 pl-5">
            {data.graduate_profile.map((profile) => (
              <li key={profile} className="text-xs leading-relaxed text-secondary">{profile}</li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
