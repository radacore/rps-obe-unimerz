import type { CpmkItem } from "./admin";

/**
 * Bentuk isian wizard pembuatan RPS.
 *
 * Seluruh dokumen disusun di satu tempat lalu dikirim sekali jalan, sehingga
 * dosen tidak lagi berpindah antara halaman "buat draft" dan halaman detail
 * untuk melengkapi isinya.
 */

export type Lecturer = { name: string; nidn: string; role: LecturerRole };
export type LecturerRole = "pengembang" | "koordinator_mk" | "ketua_prodi" | "anggota";

export type CpItem = { code: string; description: string; taxonomy?: string | null; cpl_code?: string | null; cpmk_code?: string | null };

export type WeeklyRow = {
  week: string;
  is_merged: boolean;
  weight: number;
  sub_cpmk?: string;
  indikator?: string;
  kriteria?: string;
  daring?: string;
  luring?: string;
  materi?: string;
  material?: string;
  method?: string;
  experience?: string;
  assessment_criteria?: string;
};

/** Sumber isi dokumen yang dipilih di langkah 2. */
export type ContentSource = "curriculum" | "ai" | "manual";

export type RpsFormState = {
  // Langkah 1 — identitas
  course_name: string;
  course_code: string;
  course_cluster: string;
  faculty: string;
  study_program: string;
  semester: string;
  sks_theory: number;
  sks_practice: number;
  preparation_date: string;
  lecturers: Lecturer[];

  // Langkah 2 — sumber isi
  source: ContentSource | null;
  source_course_id: number | null;

  // Langkah 3 — deskripsi & pustaka
  description: string;
  bahan_kajian: string[];
  pustaka_utama: string[];
  pustaka_pendukung: string[];

  // Langkah 4 — capaian pembelajaran
  cpl: CpItem[];
  cpmk: CpItem[];
  sub_cpmk: CpItem[];

  // Langkah 5 — rencana mingguan
  weekly_plans: WeeklyRow[];
};

export const STEP_IDS = ["identitas", "sumber", "deskripsi", "capaian", "mingguan", "tinjau"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_LABELS: Record<StepId, string> = {
  identitas: "Identitas MK",
  sumber: "Sumber isi",
  deskripsi: "Deskripsi & Pustaka",
  capaian: "CPL, CPMK, Sub-CPMK",
  mingguan: "Rencana 16 minggu",
  tinjau: "Tinjau & Terbitkan",
};

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sembilan baris mewakili 16 pertemuan, dengan UTS di baris ke-5 dan UAS di
 * baris terakhir — mengikuti struktur tabel pada template DOCX.
 */
export const CANONICAL_WEEKS: { week: string; weight: number; is_merged: boolean; label?: string }[] = [
  { week: "1", weight: 5, is_merged: false },
  { week: "2", weight: 5, is_merged: false },
  { week: "3, 4", weight: 10, is_merged: false },
  { week: "5, 6, 7", weight: 20, is_merged: false },
  { week: "8", weight: 0, is_merged: true, label: "UJIAN MID SEMESTER" },
  { week: "9, 10, 11", weight: 30, is_merged: false },
  { week: "12, 13", weight: 10, is_merged: false },
  { week: "14, 15", weight: 20, is_merged: false },
  { week: "16", weight: 0, is_merged: true, label: "UJIAN FINAL SEMESTER" },
];

export function emptyWeeklyPlans(): WeeklyRow[] {
  return CANONICAL_WEEKS.map((w) => ({
    week: w.week,
    weight: w.weight,
    is_merged: w.is_merged,
    materi: w.label ?? "",
    sub_cpmk: w.label ?? "",
    indikator: "",
    kriteria: "",
    daring: "",
    luring: "",
  }));
}

export function initialFormState(defaults?: Partial<RpsFormState>): RpsFormState {
  return {
    course_name: "",
    course_code: "",
    course_cluster: "",
    faculty: "",
    study_program: "",
    semester: "",
    sks_theory: 2,
    sks_practice: 1,
    preparation_date: todayISO(),
    lecturers: [{ name: "", nidn: "", role: "koordinator_mk" }],
    source: null,
    source_course_id: null,
    description: "",
    bahan_kajian: [],
    pustaka_utama: [],
    pustaka_pendukung: [],
    cpl: [],
    cpmk: [],
    sub_cpmk: [],
    weekly_plans: emptyWeeklyPlans(),
    ...defaults,
  };
}

/** Ubah CPMK bank kurikulum menjadi bentuk yang dipakai dokumen RPS. */
export function flattenCurriculumCpmk(cpmk: CpmkItem[]): { cpmk: CpItem[]; sub_cpmk: CpItem[] } {
  return {
    cpmk: cpmk.map((c) => ({
      code: c.code, description: c.description,
      taxonomy: c.taxonomy ?? null, cpl_code: c.cpl_code ?? null,
    })),
    sub_cpmk: cpmk.flatMap((parent) => parent.sub_cpmk.map((sub) => ({
      code: sub.code, description: sub.description,
      taxonomy: sub.taxonomy ?? null, cpmk_code: parent.code,
    }))),
  };
}

export const NIDN_PATTERN = /^\d{10}$/;

/**
 * Kekurangan tiap langkah, dinyatakan sebagai daftar kalimat.
 *
 * Dipakai dua tempat: penanda status pada stepper, dan daftar "yang masih
 * kurang" di langkah terakhir. Satu sumber kebenaran supaya tidak ada langkah
 * yang tampak lengkap padahal penerbitannya ditolak.
 */
export function stepIssues(form: RpsFormState, stepId: StepId): string[] {
  const issues: string[] = [];
  const sksTotal = form.sks_theory + form.sks_practice;

  switch (stepId) {
    case "identitas": {
      if (form.course_name.trim().length < 2) issues.push("Nama mata kuliah belum diisi");
      if (form.course_code.trim().length < 2) issues.push("Kode mata kuliah belum diisi");
      if (!form.faculty) issues.push("Fakultas belum dipilih");
      if (!form.study_program) issues.push("Program studi belum dipilih");
      if (!form.semester.trim()) issues.push("Semester belum diisi");
      if (sksTotal < 1) issues.push("Total SKS harus lebih dari 0");
      if (!form.preparation_date) issues.push("Tanggal penyusunan belum diisi");

      const named = form.lecturers.filter((l) => l.name.trim().length >= 2);
      if (named.length === 0) issues.push("Minimal satu dosen pengampu");
      if (!form.lecturers.some((l) => l.role === "koordinator_mk" && l.name.trim().length >= 2)) {
        issues.push("Harus ada Koordinator MK yang bernama");
      }
      const badNidn = named.filter((l) => !NIDN_PATTERN.test(l.nidn.trim()));
      if (badNidn.length > 0) issues.push("NIDN dosen harus 10 digit angka");
      break;
    }
    case "sumber": {
      if (!form.source) issues.push("Pilih sumber isi dokumen");
      if (form.source === "curriculum" && !form.source_course_id) {
        issues.push("Pilih mata kuliah dari bank kurikulum");
      }
      break;
    }
    case "deskripsi": {
      if (form.description.trim().length < 20) issues.push("Deskripsi MK minimal 20 karakter");
      if (form.bahan_kajian.length === 0) issues.push("Bahan kajian belum diisi");
      if (form.pustaka_utama.length === 0) issues.push("Pustaka utama belum diisi");
      break;
    }
    case "capaian": {
      if (form.cpl.length === 0) issues.push("CPL yang dibebankan belum diisi");
      if (form.cpmk.length === 0) issues.push("CPMK belum diisi");
      if (form.sub_cpmk.length === 0) issues.push("Sub-CPMK belum diisi");
      const incomplete = [...form.cpl, ...form.cpmk, ...form.sub_cpmk]
        .filter((x) => !x.code.trim() || x.description.trim().length < 10);
      if (incomplete.length > 0) issues.push("Ada butir capaian tanpa kode atau deskripsinya terlalu pendek");
      break;
    }
    case "mingguan": {
      const rows = form.weekly_plans;
      if (rows.length !== 9) {
        issues.push("Rencana mingguan harus 9 baris (mewakili 16 pertemuan)");
        break;
      }
      const total = rows.filter((r) => !r.is_merged).reduce((n, r) => n + (Number(r.weight) || 0), 0);
      if (total !== 100) issues.push(`Total bobot penilaian ${total}%, harus tepat 100%`);
      const emptyRows = rows.filter((r) => !r.is_merged && !(r.materi ?? "").trim());
      if (emptyRows.length > 0) issues.push(`${emptyRows.length} baris belum punya materi pembelajaran`);
      break;
    }
    case "tinjau":
      // Langkah tinjau merangkum langkah lain, tanpa isian sendiri.
      break;
  }
  return issues;
}

/** Langkah mana saja yang belum lengkap. */
export function incompleteSteps(form: RpsFormState): { id: StepId; issues: string[] }[] {
  return STEP_IDS
    .filter((id) => id !== "tinjau")
    .map((id) => ({ id, issues: stepIssues(form, id) }))
    .filter((s) => s.issues.length > 0);
}

export function isReadyToPublish(form: RpsFormState): boolean {
  return incompleteSteps(form).length === 0;
}

/** Payload untuk `POST /api/rps` maupun `POST /api/rps/preview`. */
export function toApiPayload(form: RpsFormState) {
  return {
    course_name: form.course_name.trim(),
    course_code: form.course_code.trim(),
    course_cluster: form.course_cluster.trim() || form.study_program,
    faculty: form.faculty,
    study_program: form.study_program,
    sks_total: form.sks_theory + form.sks_practice,
    sks_theory: form.sks_theory,
    sks_practice: form.sks_practice,
    semester: form.semester.trim(),
    preparation_date: form.preparation_date,
    lecturers: form.lecturers
      .filter((l) => l.name.trim().length >= 2)
      .map((l) => ({ name: l.name.trim(), nidn: l.nidn.trim(), role: l.role })),
    description: form.description.trim(),
    bahan_kajian: form.bahan_kajian,
    pustaka_utama: form.pustaka_utama,
    pustaka_pendukung: form.pustaka_pendukung,
    cpl: form.cpl,
    cpmk: form.cpmk,
    sub_cpmk: form.sub_cpmk,
    weekly_plans: form.weekly_plans,
  };
}

/** Bentuk hasil penyusunan AI yang dipakai wizard. */
export type AiDraftResult = {
  description?: string;
  bahan_kajian?: string[];
  pustaka_utama?: string[];
  pustaka_pendukung?: string[];
  cpl?: { code?: string; description?: string }[];
  cpmk?: { code?: string; description?: string; taxonomy?: string; cpl_code?: string }[];
  sub_cpmk?: { code?: string; description?: string; taxonomy?: string; cpmk_code?: string }[];
  weeklyPlans?: Record<string, unknown>[];
};

/**
 * Terjemahkan hasil AI menjadi isian wizard.
 *
 * Generator memakai nama medan warisan (`material`, `assessment_criteria`) yang
 * berbeda dari medan formulir, dan baris ujian tidak boleh menimpa struktur
 * 16 pertemuan. Keduanya diselaraskan di satu tempat ini.
 */
export function aiDraftToForm(g: AiDraftResult): Partial<RpsFormState> {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const lines = (v: unknown) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

  const next: Partial<RpsFormState> = {};
  if (text(g.description)) next.description = text(g.description);
  if (lines(g.bahan_kajian).length) next.bahan_kajian = lines(g.bahan_kajian);
  if (lines(g.pustaka_utama).length) next.pustaka_utama = lines(g.pustaka_utama);
  if (lines(g.pustaka_pendukung).length) next.pustaka_pendukung = lines(g.pustaka_pendukung);

  const cp = (rows: { code?: string; description?: string; taxonomy?: string }[] | undefined) =>
    (rows ?? [])
      .map((r) => ({ code: text(r.code), description: text(r.description), taxonomy: text(r.taxonomy) }))
      .filter((r) => r.code || r.description);
  if (cp(g.cpl).length) next.cpl = cp(g.cpl);
  if (cp(g.cpmk).length) next.cpmk = cp(g.cpmk);
  if (cp(g.sub_cpmk).length) next.sub_cpmk = cp(g.sub_cpmk);

  // Baris mingguan dipetakan ke kerangka baku supaya jumlah dan posisi baris
  // ujian tetap cocok dengan template dokumen.
  const rows = Array.isArray(g.weeklyPlans) ? g.weeklyPlans : [];
  if (rows.length) {
    next.weekly_plans = CANONICAL_WEEKS.map((canon, i) => {
      const r = rows[i] ?? {};
      const pick = (...keys: string[]) => {
        for (const k of keys) { const v = text(r[k]); if (v) return v; }
        return "";
      };
      const weight = typeof r.weight === "number" && Number.isFinite(r.weight) ? r.weight : 0;
      return {
        week: canon.week,
        is_merged: canon.is_merged,
        weight: canon.is_merged ? 0 : weight,
        materi: canon.is_merged ? (canon.label ?? "") : pick("materi", "material"),
        sub_cpmk: canon.is_merged ? "" : pick("sub_cpmk", "subCpmk"),
        indikator: canon.is_merged ? "" : pick("indikator", "indicator"),
        kriteria: canon.is_merged ? "" : pick("kriteria", "assessment_criteria", "criteria"),
        luring: canon.is_merged ? "" : pick("luring", "method", "offline"),
        daring: canon.is_merged ? "" : pick("daring", "online"),
      };
    });
  }
  return next;
}
