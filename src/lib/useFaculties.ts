import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type ApiOk } from "./api";
import { FACULTIES, type Fakultas, type Prodi } from "./faculties";

/**
 * Daftar fakultas + prodi dari database.
 *
 * Sebelumnya dropdown membaca konstanta di `faculties.ts`, sehingga profil yang
 * diubah admin tidak akan pernah terlihat di form RPS. Sumbernya sekarang DB,
 * dengan konstanta hanya sebagai cadangan saat request pertama belum selesai
 * atau API sedang tidak bisa dihubungi.
 */
export type FacultyWithPrograms = Fakultas;

function fetchFaculties() {
  return api<ApiOk<FacultyWithPrograms[]>>("/api/faculties");
}

export function useFaculties() {
  const q = useQuery({
    queryKey: ["faculties"],
    queryFn: fetchFaculties,
    // Master data jarang berubah; hindari refetch tiap render dropdown.
    staleTime: 5 * 60 * 1000,
    throwOnError: false,
  });

  const faculties: FacultyWithPrograms[] = q.data?.data?.length ? q.data.data : FACULTIES;

  return useMemo(() => ({
    faculties,
    isFallback: !q.data?.data?.length,
    facultyOptions: faculties.map((f) => ({ value: f.label, label: f.label })),
    prodisForFaculty: (facultyLabel: string): Prodi[] =>
      faculties.find((f) => f.label === facultyLabel)?.prodis ?? [],
  }), [faculties, q.data]);
}
