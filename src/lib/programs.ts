import { api, type ApiOk } from "./api";

export type Program = {
  slug: string;
  faculty_label: string;
  faculty_slug: string;
  label: string;
  value: string;
  akreditasi: string | null;
  href: string | null;
  vision: string | null;
  mission: string[];
  objective: string[];
  graduate_profile: string[];
  cpl: { code: string; description: string }[];
  source_url: string | null;
  source_timestamp: string | null;
  completeness: string;
};

export function fetchProgram(slugOrValue: string) {
  return api<ApiOk<Program>>(`/api/programs/${encodeURIComponent(slugOrValue)}`);
}

export function fetchPrograms(params?: { facultySlug?: string; q?: string; completeness?: string }) {
  const qs = new URLSearchParams();
  if (params?.facultySlug) qs.set("facultySlug", params.facultySlug);
  if (params?.q) qs.set("q", params.q);
  if (params?.completeness) qs.set("completeness", params.completeness);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return api<ApiOk<Program[]>>(`/api/programs${suffix}`);
}
