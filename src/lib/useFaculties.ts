import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type ApiOk } from "./api";
import { FACULTIES, type Prodi } from "./faculties";

/**
 * Daftar fakultas + program studi dari database.
 *
 * Sebelumnya dropdown membaca konstanta di `faculties.ts`, sehingga profil yang
 * diubah admin tidak akan pernah terlihat di form RPS. Sumbernya sekarang DB,
 * dengan konstanta hanya sebagai cadangan saat request pertama belum selesai
 * atau API sedang tidak bisa dihubungi.
 */

/** Bentuk respons `GET /api/faculties` — sengaja dinyatakan eksplisit. */
type FacultyResponse = {
  slug: string;
  label: string;
  href: string | null;
  vision: string | null;
  mission: string[];
  objective: string[];
  programs: { slug: string; label: string; value: string; akreditasi: string | null }[];
};

/** Bentuk seragam yang dipakai komponen, apa pun sumber datanya. */
export type FacultyOption = {
  slug: string;
  label: string;
  href: string | null;
  prodis: Prodi[];
};

function fetchFaculties() {
  return api<ApiOk<FacultyResponse[]>>("/api/faculties");
}

/**
 * Konstanta cadangan tidak punya `slug` prodi. Fitur yang memerlukan slug
 * (mis. membuat akun kaprodi) harus menyaring prodi tanpa slug alih-alih
 * menebaknya.
 */
const FALLBACK: FacultyOption[] = FACULTIES.map((f) => ({
  slug: f.slug,
  label: f.label,
  href: f.href,
  prodis: f.prodis,
}));

export function useFaculties() {
  const q = useQuery({
    queryKey: ["faculties"],
    queryFn: fetchFaculties,
    // Master data jarang berubah; hindari refetch tiap render dropdown.
    staleTime: 5 * 60 * 1000,
    throwOnError: false,
  });

  const rows = q.data?.data;

  return useMemo(() => {
    // Nama field API (`programs`) berbeda dari bentuk yang dipakai komponen
    // (`prodis`); pemetaan dilakukan di satu tempat ini supaya ketidakcocokan
    // tidak menyebar ke pemanggil.
    const faculties: FacultyOption[] = rows?.length
      ? rows.map((f) => ({
          slug: f.slug,
          label: f.label,
          href: f.href,
          prodis: f.programs.map((p) => ({
            slug: p.slug,
            label: p.label,
            value: p.value,
            akreditasi: p.akreditasi,
          })),
        }))
      : FALLBACK;

    return {
      faculties,
      isFallback: !rows?.length,
      facultyOptions: faculties.map((f) => ({ value: f.label, label: f.label })),
      prodisForFaculty: (facultyLabel: string): Prodi[] =>
        faculties.find((f) => f.label === facultyLabel)?.prodis ?? [],
    };
  }, [rows]);
}
