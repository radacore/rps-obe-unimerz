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
