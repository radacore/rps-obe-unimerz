/**
 * Fakultas & Program Studi — Universitas Megarezky (UNIMERZ) Makassar
 * Sumber: input user 2026-09-10 — 8 fakultas (termasuk Pascasarjana) + 30 prodi S1/D3/D4/Profesi + 7 S2
 * Kop surat DOCX dinamis per fakultas/prodi (Cover P20/P21, kop R00, R03/R04).
 */
/** `slug` hanya ada bila data berasal dari API; konstanta cadangan tidak memuatnya. */
export type Prodi = { label: string; value: string; akreditasi?: string | null; slug?: string };
export type Fakultas = { slug: string; label: string; href: string; prodis: Prodi[] };

export const FACULTIES: Fakultas[] = [
  {
    slug: "kedokteran",
    label: "Fakultas Kedokteran",
    href: "https://unimerz.ac.id/kedokteran/",
    prodis: [
      { label: "S1 Kedokteran", value: "S1 Kedokteran" },
      { label: "Profesi Dokter", value: "Profesi Dokter" },
      { label: "S1 Sains Biomedis", value: "S1 Sains Biomedis" },
      { label: "S1 Administrasi Rumah Sakit", value: "S1 Administrasi Rumah Sakit" },
    ],
  },
  {
    slug: "fkk",
    label: "Fakultas Keperawatan dan Kebidanan",
    href: "https://unimerz.ac.id/fkk/",
    prodis: [
      { label: "S1 Ilmu Keperawatan", value: "S1 Ilmu Keperawatan", akreditasi: "Baik Sekali" },
      { label: "Profesi Ners", value: "Profesi Ners", akreditasi: "Baik" },
      { label: "S1 Kebidanan", value: "S1 Kebidanan", akreditasi: "Baik" },
      { label: "D4 Kebidanan", value: "D4 Kebidanan" },
      { label: "D3 Kebidanan", value: "D3 Kebidanan", akreditasi: "Baik Sekali" },
      { label: "Profesi Bidan", value: "Profesi Bidan", akreditasi: "Baik" },
      { label: "S1 Gizi", value: "S1 Gizi", akreditasi: "Baik" },
    ],
  },
  {
    slug: "farmasi",
    label: "Fakultas Farmasi",
    href: "https://unimerz.ac.id/fakultas-farmasi/",
    prodis: [
      { label: "S1 Farmasi", value: "S1 Farmasi", akreditasi: "B" },
      { label: "D3 Farmasi", value: "D3 Farmasi", akreditasi: "B" },
      { label: "Profesi Apoteker", value: "Profesi Apoteker", akreditasi: "Baik" },
    ],
  },
  {
    slug: "fatelkes",
    label: "Fakultas Teknologi Kesehatan",
    href: "https://unimerz.ac.id/fatelkes/",
    prodis: [
      { label: "D4 Teknologi Laboratorium Medis", value: "D4 Teknologi Laboratorium Medis", akreditasi: "Baik" },
      { label: "D3 Teknologi Laboratorium Medis", value: "D3 Teknologi Laboratorium Medis", akreditasi: "B" },
      { label: "D3 Optometri", value: "D3 Optometri", akreditasi: "Baik" },
      { label: "D3 Teknik Kardiovaskuler", value: "D3 Teknik Kardiovaskuler", akreditasi: "Baik" },
      { label: "D3 Teknik Gigi", value: "D3 Teknik Gigi", akreditasi: "B" },
      { label: "S1 Bioinformatika", value: "S1 Bioinformatika", akreditasi: "Baik" },
    ],
  },
  {
    slug: "fikom",
    label: "Fakultas Ilmu Komputer",
    href: "https://unimerz.ac.id/fikom/",
    prodis: [
      { label: "S1 Ilmu Komputer", value: "S1 Ilmu Komputer", akreditasi: "Baik" },
      { label: "S1 Sistem Informasi", value: "S1 Sistem Informasi", akreditasi: "Baik" },
    ],
  },
  {
    slug: "fkip",
    label: "Fakultas Keguruan dan Ilmu Pendidikan",
    href: "https://unimerz.ac.id/fkip/",
    prodis: [
      { label: "S1 Pendidikan Guru Sekolah Dasar (PGSD)", value: "S1 Pendidikan Guru Sekolah Dasar", akreditasi: "Unggul" },
      { label: "S1 Pendidikan Jasmani", value: "S1 Pendidikan Jasmani", akreditasi: "Unggul" },
      { label: "S1 Pendidikan Bahasa Inggris", value: "S1 Pendidikan Bahasa Inggris", akreditasi: "Unggul" },
      { label: "S1 Pendidikan Sosiologi", value: "S1 Pendidikan Sosiologi", akreditasi: "Unggul" },
      { label: "S1 Pendidikan Teknologi Informasi", value: "S1 Pendidikan Teknologi Informasi", akreditasi: "Baik" },
    ],
  },
  {
    slug: "febdh",
    label: "Fakultas Ekonomi, Bisnis Digital, dan Hukum",
    href: "https://unimerz.ac.id/fakultas-ekbis/",
    prodis: [
      { label: "S1 Bisnis Digital", value: "S1 Bisnis Digital", akreditasi: "Baik" },
      { label: "S1 Kewirausahaan", value: "S1 Kewirausahaan", akreditasi: "Baik" },
      { label: "S1 Hukum Bisnis", value: "S1 Hukum Bisnis", akreditasi: "Baik" },
    ],
  },
  {
    slug: "propas",
    label: "Program Pascasarjana",
    href: "https://unimerz.ac.id/propas/",
    prodis: [
      { label: "S2 Kesehatan Reproduksi", value: "S2 Kesehatan Reproduksi", akreditasi: "Baik Sekali" },
      { label: "S2 Administrasi Rumah Sakit", value: "S2 Administrasi Rumah Sakit", akreditasi: "Baik Sekali" },
      { label: "S2 Promosi Kesehatan", value: "S2 Promosi Kesehatan", akreditasi: "Baik Sekali" },
      { label: "S2 Sains Laboratorium Medis", value: "S2 Sains Laboratorium Medis" },
      { label: "S2 Farmasi", value: "S2 Farmasi", akreditasi: "Baik" },
      { label: "S2 Pendidikan Jasmani", value: "S2 Pendidikan Jasmani" },
      { label: "S2 Pendidikan Sosiologi", value: "S2 Pendidikan Sosiologi", akreditasi: "Baik Sekali" },
    ],
  },
];

export const DEFAULT_FACULTY = "Fakultas Keperawatan dan Kebidanan";
export const DEFAULT_PRODI = "S1 Ilmu Keperawatan";

export function prodisForFaculty(facultyLabel: string): Prodi[] {
  const f = FACULTIES.find((x) => x.label === facultyLabel);
  return f ? f.prodis : [];
}

export function allProdiOptions(): { value: string; label: string }[] {
  return FACULTIES.flatMap((f) => f.prodis.map((p) => ({ value: p.value, label: `${p.label} — ${f.label}` })));
}
