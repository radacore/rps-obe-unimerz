import { api, type ApiOk } from "./api";

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
  cpl: { code: string; description: string }[];
  updated_at: string;
};

export type ProgramProfilePatch = {
  vision?: string | null;
  mission?: string[];
  objective?: string[];
  graduate_profile?: string[];
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

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  faculty_admin: "Admin Fakultas",
};
