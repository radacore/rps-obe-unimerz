import { api, ApiError, type ApiOk } from "./api";

export type AdminRole = "super_admin" | "faculty_admin";

export type AdminIdentity = {
  id: number;
  nidn: string;
  name: string;
  role: AdminRole;
  facultyId: number | null;
  facultyLabel: string | null;
  facultySlug: string | null;
  mustChangePassword: boolean;
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
};
