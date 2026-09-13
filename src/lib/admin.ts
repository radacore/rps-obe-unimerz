import { api, ApiError, type ApiOk } from "./api";

export type AdminRole = "super_admin" | "faculty_admin" | "kaprodi" | "dosen";

export type AdminIdentity = {
  id: number;
  nidn: string;
  name: string;
  role: AdminRole;
  facultyId: number | null;
  facultyLabel: string | null;
  facultySlug: string | null;
  studyProgramId: number | null;
  studyProgramLabel: string | null;
  studyProgramSlug: string | null;
  mustChangePassword: boolean;
  /** Disertakan `GET /api/admin/me`: apakah akun ini punya API key aktif. */
  has_api_key?: boolean;
  api_key_count?: number;
};

export type CplCategory = "sikap" | "pengetahuan" | "keterampilan_umum" | "keterampilan_khusus";

export type CplItem = {
  code: string;
  description: string;
  category?: CplCategory | null;
};

/** Label kategori CPL menurut SN-Dikti, untuk dropdown. */
export const CPL_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— belum diklasifikasi —" },
  { value: "sikap", label: "Sikap" },
  { value: "pengetahuan", label: "Pengetahuan" },
  { value: "keterampilan_umum", label: "Keterampilan Umum" },
  { value: "keterampilan_khusus", label: "Keterampilan Khusus" },
];

export type AdminProgram = {
  slug: string;
  label: string;
  value: string;
  faculty_label: string;
  faculty_slug: string;
  akreditasi: string | null;
  completeness: string;
  vision: string | null;
  mission: string[];
  objective: string[];
  graduate_profile: string[];
  cpl: CplItem[];
  updated_at: string;
};

export type AdminFaculty = {
  slug: string;
  label: string;
  href: string | null;
  vision: string | null;
  mission: string[];
  objective: string[];
  program_count: number;
  updated_at: string;
};

export type ProgramProfilePatch = {
  vision?: string | null;
  mission?: string[];
  objective?: string[];
  graduate_profile?: string[];
};

export type FacultyProfilePatch = {
  vision?: string | null;
  mission?: string[];
  objective?: string[];
};

export function adminLogin(nidn: string, password: string) {
  return api<ApiOk<AdminIdentity>>("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ nidn, password }),
  });
}

export function adminLogout() {
  return api<ApiOk<{ loggedOut: boolean }>>("/api/admin/logout", { method: "POST" });
}

export function fetchAdminMe() {
  return api<ApiOk<AdminIdentity>>("/api/admin/me");
}

/**
 * Sesi saat ini, dengan "belum login" sebagai hasil yang sah (`null`) alih-alih
 * kegagalan.
 *
 * Memperlakukan 401 sebagai error membuat query berada dalam status gagal
 * permanen, dan komponen yang menampilkan form login me-mount ulang query yang
 * sama sehingga terjadi refetch berulang tanpa henti.
 */
export async function fetchAdminSession(): Promise<AdminIdentity | null> {
  try {
    const res = await fetchAdminMe();
    return res.data;
  } catch (e) {
    if (e instanceof ApiError && (e.isUnauthorized || e.isForbidden)) return null;
    throw e;
  }
}

/** Query key tunggal untuk sesi admin, dipakai bersama seluruh komponen. */
export const ADMIN_SESSION_KEY = ["admin-session"] as const;

export function adminChangePassword(currentPassword: string, newPassword: string) {
  return api<ApiOk<{ changed: boolean }>>("/api/admin/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

/** Prodi dalam wewenang admin: super admin semua, admin fakultas hanya miliknya. */
export function fetchAdminPrograms() {
  return api<ApiOk<AdminProgram[]>>("/api/admin/programs");
}

export function updateProgramProfile(slug: string, patch: ProgramProfilePatch) {
  return api<ApiOk<AdminProgram>>(`/api/admin/programs/${encodeURIComponent(slug)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function updateProgramCpl(slug: string, cpl: CplItem[]) {
  return api<ApiOk<{ slug: string; label: string; cpl: CplItem[] }>>(
    `/api/admin/programs/${encodeURIComponent(slug)}/cpl`,
    { method: "PUT", body: JSON.stringify({ cpl }) },
  );
}

/** Fakultas dalam wewenang admin. */
export function fetchAdminFaculties() {
  return api<ApiOk<AdminFaculty[]>>("/api/admin/faculties");
}

export function updateFacultyProfile(slug: string, patch: FacultyProfilePatch) {
  return api<ApiOk<AdminFaculty>>(`/api/admin/faculties/${encodeURIComponent(slug)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  faculty_admin: "Admin Fakultas",
  kaprodi: "Kaprodi",
  dosen: "Dosen",
};

export const ROLE_OPTIONS: { value: AdminRole; label: string }[] = [
  { value: "dosen", label: "Dosen — menulis RPS pada prodinya" },
  { value: "kaprodi", label: "Kaprodi — satu program studi" },
  { value: "faculty_admin", label: "Admin Fakultas — seluruh prodi di fakultasnya" },
  { value: "super_admin", label: "Super Admin — seluruh universitas + kelola akun" },
];

export type AdminAccount = {
  id: number;
  nidn: string;
  name: string;
  role: AdminRole;
  faculty_label: string | null;
  faculty_slug: string | null;
  study_program_label: string | null;
  study_program_slug: string | null;
  is_active: boolean;
  must_change_password: boolean;
  is_locked: boolean;
  last_login_at: string | null;
  created_at: string;
};

export type NewAccountInput = {
  nidn: string;
  name: string;
  role: AdminRole;
  faculty_slug?: string;
  study_program_slug?: string;
};

export type AccountPatch = {
  name?: string;
  role?: AdminRole;
  faculty_slug?: string | null;
  study_program_slug?: string | null;
  is_active?: boolean;
};

export function fetchAccounts() {
  return api<ApiOk<AdminAccount[]>>("/api/admin/accounts");
}

/** Password sementara hanya dikembalikan sekali, di respons ini. */
export function createAccount(input: NewAccountInput) {
  return api<ApiOk<{ account: AdminAccount; temporary_password: string }>>("/api/admin/accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAccount(nidn: string, patch: AccountPatch) {
  return api<ApiOk<AdminAccount>>(`/api/admin/accounts/${encodeURIComponent(nidn)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function resetAccountPassword(nidn: string) {
  return api<ApiOk<{ nidn: string; name: string; temporary_password: string }>>(
    `/api/admin/accounts/${encodeURIComponent(nidn)}/reset-password`,
    { method: "POST" },
  );
}

export type AuditEntry = {
  id: number;
  actor_nidn: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_ref: string;
  entity_label: string | null;
  changes: Record<string, { before: unknown; after: unknown }>;
  created_at: string;
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  create_course: "Tambah mata kuliah",
  update_course: "Ubah mata kuliah",
  delete_course: "Hapus mata kuliah",
  update_course_cpmk: "Ubah CPMK mata kuliah",
  update_faculty_profile: "Ubah profil fakultas",
  update_program_profile: "Ubah profil prodi",
  update_program_cpl: "Ubah CPL prodi",
  create_account: "Buat akun",
  update_account: "Ubah akun",
  reset_password: "Reset password",
  deactivate_account: "Nonaktifkan akun",
  activate_account: "Aktifkan akun",
};

export function fetchAudit(limit = 50) {
  return api<ApiOk<AuditEntry[]>>(`/api/admin/audit?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Bank kurikulum
// ---------------------------------------------------------------------------

export type SubCpmkItem = {
  code: string;
  description: string;
  taxonomy?: string | null;
};

export type CpmkItem = {
  code: string;
  description: string;
  taxonomy?: string | null;
  cpl_code?: string | null;
  sub_cpmk: SubCpmkItem[];
};

export type Course = {
  id: number;
  code: string;
  name: string;
  cluster: string | null;
  semester: number;
  sks_theory: number;
  sks_practice: number;
  sks_total: number;
  is_elective: boolean;
  description: string | null;
  bahan_kajian: string[];
  pustaka_utama: string[];
  pustaka_pendukung: string[];
  study_program_slug: string | null;
  study_program_label: string | null;
  faculty_label: string | null;
  cpmk: CpmkItem[];
  cpmk_count: number;
  sub_cpmk_count: number;
  updated_at: string;
};

export type NewCourseInput = {
  study_program_slug: string;
  code: string;
  name: string;
  semester: number;
  sks_theory: number;
  sks_practice: number;
  cluster?: string | null;
  description?: string | null;
  bahan_kajian?: string[];
  pustaka_utama?: string[];
  pustaka_pendukung?: string[];
};

export type CoursePatch = Partial<Omit<NewCourseInput, "study_program_slug">> & { is_elective?: boolean };

export function fetchCourses(studyProgramSlug?: string) {
  const qs = studyProgramSlug ? `?study_program_slug=${encodeURIComponent(studyProgramSlug)}` : "";
  return api<ApiOk<Course[]>>(`/api/admin/courses${qs}`);
}

export function createCourse(input: NewCourseInput) {
  return api<ApiOk<Course>>("/api/admin/courses", { method: "POST", body: JSON.stringify(input) });
}

export function updateCourse(id: number, patch: CoursePatch) {
  return api<ApiOk<Course>>(`/api/admin/courses/${id}`, { method: "PUT", body: JSON.stringify(patch) });
}

export function deleteCourse(id: number) {
  return api<ApiOk<{ deleted: boolean }>>(`/api/admin/courses/${id}`, { method: "DELETE" });
}

export function updateCourseCpmk(id: number, cpmk: CpmkItem[]) {
  return api<ApiOk<Course>>(`/api/admin/courses/${id}/cpmk`, {
    method: "PUT",
    body: JSON.stringify({ cpmk }),
  });
}

export type MatrixSupport = {
  course_id: number;
  course_code: string;
  course_name: string;
  semester: number;
  cpmk_code: string;
  cpmk_description: string;
  taxonomy: string | null;
  sub_cpmk_count: number;
};

export type ProgramMatrix = {
  study_program: { slug: string; label: string; faculty_label: string };
  graduate_profile: string[];
  cpl: {
    code: string;
    description: string;
    category: string | null;
    supporting: MatrixSupport[];
    is_covered: boolean;
  }[];
  uncovered_cpl: string[];
  orphan_cpmk: { course_code: string; course_name: string; cpmk_code: string; cpl_code: string | null }[];
  course_count: number;
  cpmk_count: number;
};

export function fetchProgramMatrix(slug: string) {
  return api<ApiOk<ProgramMatrix>>(`/api/admin/programs/${encodeURIComponent(slug)}/matrix`);
}

/** Bank kurikulum publik — dipakai halaman RPS untuk mengisi dari kurikulum. */
export function fetchPublicCourses(studyProgramValue: string) {
  return api<ApiOk<Course[]>>(`/api/courses?study_program=${encodeURIComponent(studyProgramValue)}`);
}

export function applyCourseToDraft(draftId: number, courseId: number) {
  return api<ApiOk<{ course_code: string; course_name: string; applied: { cpl: number; cpmk: number; sub_cpmk: number } }>>(
    `/api/rps/${draftId}/apply-course`,
    { method: "POST", body: JSON.stringify({ course_id: courseId }) },
  );
}

export const TAXONOMY_OPTIONS = [
  { value: "", label: "—" },
  ...["C1", "C2", "C3", "C4", "C5", "C6"].map((v) => ({ value: v, label: `${v} (kognitif)` })),
  ...["A1", "A2", "A3", "A4", "A5"].map((v) => ({ value: v, label: `${v} (afektif)` })),
  ...["P1", "P2", "P3", "P4", "P5"].map((v) => ({ value: v, label: `${v} (psikomotor)` })),
];
