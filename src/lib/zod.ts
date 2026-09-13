import { z } from "zod";

export const lecturerSchema = z.object({
  name: z.string().min(2),
  nidn: z.string().min(1),
  role: z.enum(["pengembang", "koordinator_mk", "ketua_prodi", "anggota"]),
});

export const rpsCreateSchema = z.object({
  course_name: z.string().min(2),
  course_code: z.string().min(2),
  course_cluster: z.string().optional(),
  faculty: z.string().optional(),
  study_program: z.string().optional(),
  sks_total: z.number().int().min(1).max(12),
  sks_theory: z.number().int().min(0).max(12),
  sks_practice: z.number().int().min(0).max(12),
  semester: z.string().min(1),
  preparation_date: z.string().min(4),
  lecturers: z.array(lecturerSchema).min(1),
  description: z.string().optional(),
  cpl_hint: z.string().optional(),
  cpmk_hint: z.string().optional(),
}).refine((d) => d.sks_total === d.sks_theory + d.sks_practice, { message: "sks_total harus = T+P", path: ["sks_total"] })
  .refine((d) => d.lecturers.some((l) => l.role === "koordinator_mk"), { message: "Minimal 1 Koordinator MK", path: ["lecturers"] });

export const weeklyPlanSchema = z.object({
  week: z.string().min(1),
  // legacy 5-field compatibility
  material: z.string().min(1),
  method: z.string().min(1),
  experience: z.string().min(1),
  assessment_criteria: z.string().min(1),
  weight: z.number().min(0).max(100),
  is_merged: z.boolean(),
  // 8-column template 1:1 (optional — when present, docx uses verbatim; when absent derive from legacy)
  sub_cpmk: z.string().optional(),
  indikator: z.string().optional(),
  kriteria: z.string().optional(),
  daring: z.string().optional(),
  luring: z.string().optional(),
  materi: z.string().optional(),
});

export const auditResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.object({ code: z.string(), severity: z.enum(["critical", "warning"]), message: z.string(), field: z.string().optional() })),
});

// ---------------------------------------------------------------------------
// Panel admin
// ---------------------------------------------------------------------------

/** NIDN PDDikti: tepat 10 digit. */
export const nidnSchema = z.string().trim().regex(/^\d{10}$/, "NIDN harus 10 digit angka");

export const adminLoginSchema = z.object({
  nidn: nidnSchema,
  // Panjang minimum tidak divalidasi di sini: aturan kekuatan hanya berlaku
  // saat MENETAPKAN password. Menolak login karena "terlalu pendek" akan
  // memberi tahu penyerang bentuk password yang tersimpan.
  password: z.string().min(1, "Password wajib diisi"),
});

const strongPassword = z.string()
  .min(12, "Password minimal 12 karakter")
  .regex(/[a-z]/, "Harus ada huruf kecil")
  .regex(/[A-Z]/, "Harus ada huruf besar")
  .regex(/\d/, "Harus ada angka");

export const adminChangePasswordSchema = z.object({
  current_password: z.string().min(1, "Password saat ini wajib diisi"),
  new_password: strongPassword,
}).refine((d) => d.current_password !== d.new_password, {
  message: "Password baru harus berbeda dari password saat ini",
  path: ["new_password"],
});

/** Baris teks bebas (misi, tujuan, profil lulusan) — dibersihkan & dibatasi. */
const textLines = z.array(z.string().trim().min(1).max(600)).max(30);

/**
 * Perubahan profil prodi oleh admin. Semua field opsional supaya panel bisa
 * menyimpan sebagian, tapi `.strict()` menolak field asing agar tidak ada
 * kolom lain (mis. `completeness`, `facultyId`) yang bisa ditumpangi lewat
 * payload yang tidak diharapkan.
 */
export const studyProgramUpdateSchema = z.object({
  vision: z.string().trim().max(2000).nullable().optional(),
  mission: textLines.optional(),
  objective: textLines.optional(),
  graduate_profile: textLines.optional(),
}).strict().refine(
  (d) => Object.keys(d).length > 0,
  { message: "Tidak ada perubahan yang dikirim" },
);

/** Profil fakultas. Bentuknya sama dengan prodi, tanpa profil lulusan. */
export const facultyUpdateSchema = z.object({
  vision: z.string().trim().max(2000).nullable().optional(),
  mission: textLines.optional(),
  objective: textLines.optional(),
}).strict().refine(
  (d) => Object.keys(d).length > 0,
  { message: "Tidak ada perubahan yang dikirim" },
);

/**
 * Kategori CPL menurut SN-Dikti. `null` diizinkan karena 37 prodi hasil
 * scraping belum punya klasifikasi ini — memaksakannya akan menolak seluruh
 * data yang sudah ada.
 */
export const CPL_CATEGORIES = [
  "sikap",
  "pengetahuan",
  "keterampilan_umum",
  "keterampilan_khusus",
] as const;

export const cplItemSchema = z.object({
  code: z.string().trim().min(2, "Kode CPL wajib diisi").max(20),
  description: z.string().trim().min(10, "Deskripsi CPL minimal 10 karakter").max(1000),
  category: z.enum(CPL_CATEGORIES).nullable().optional(),
});

export const studyProgramCplSchema = z.object({
  cpl: z.array(cplItemSchema).max(20, "Maksimal 20 CPL"),
}).strict().refine(
  (d) => new Set(d.cpl.map((x) => x.code.toUpperCase())).size === d.cpl.length,
  // Kode ganda membuat pemetaan CPMK ke CPL menjadi ambigu di dokumen RPS.
  { message: "Kode CPL tidak boleh duplikat", path: ["cpl"] },
);

// ---------------------------------------------------------------------------
// Manajemen akun (super admin)
// ---------------------------------------------------------------------------

export const ADMIN_ROLE_VALUES = ["super_admin", "faculty_admin", "kaprodi"] as const;

/**
 * Pembuatan akun oleh super admin.
 *
 * Password tidak ikut: sistem yang membuat password sementara, lalu
 * menampilkannya sekali. Membiarkan pembuat menentukan password orang lain
 * berarti ada pihak lain yang tahu kredensial pemilik akun.
 */
export const accountCreateSchema = z.object({
  nidn: nidnSchema,
  name: z.string().trim().min(3, "Nama minimal 3 karakter").max(150),
  role: z.enum(ADMIN_ROLE_VALUES),
  faculty_slug: z.string().trim().min(1).optional(),
  study_program_slug: z.string().trim().min(1).optional(),
}).strict()
  // Lingkup wajib sesuai peran: tanpa aturan ini, "kaprodi" tanpa prodi akan
  // tersimpan sebagai akun yang tidak berwenang atas apa pun (atau lebih
  // buruk, jatuh ke pemeriksaan yang salah).
  .refine((d) => d.role !== "kaprodi" || !!d.study_program_slug, {
    message: "Kaprodi wajib ditugaskan ke satu program studi",
    path: ["study_program_slug"],
  })
  .refine((d) => d.role !== "faculty_admin" || !!d.faculty_slug, {
    message: "Admin fakultas wajib ditugaskan ke satu fakultas",
    path: ["faculty_slug"],
  })
  .refine((d) => d.role !== "super_admin" || (!d.faculty_slug && !d.study_program_slug), {
    message: "Super admin tidak terikat fakultas atau program studi",
    path: ["role"],
  });

export const accountUpdateSchema = z.object({
  name: z.string().trim().min(3).max(150).optional(),
  role: z.enum(ADMIN_ROLE_VALUES).optional(),
  faculty_slug: z.string().trim().min(1).nullable().optional(),
  study_program_slug: z.string().trim().min(1).nullable().optional(),
  is_active: z.boolean().optional(),
}).strict().refine(
  (d) => Object.keys(d).length > 0,
  { message: "Tidak ada perubahan yang dikirim" },
);



