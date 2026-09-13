import { prisma } from "./db";
import type { AdminIdentity } from "./auth";

/**
 * Jejak perubahan master data OBE.
 *
 * Asesor akreditasi menanyakan siapa mengubah CPL atau visi dan kapan, dan
 * jawaban "tidak tercatat" tidak memadai. Identitas pelaku disalin sebagai teks
 * (bukan hanya relasi) supaya riwayat tetap terbaca bila akunnya dihapus.
 */

export type AuditAction =
  | "update_faculty_profile"
  | "update_program_profile"
  | "update_program_cpl"
  | "create_account"
  | "update_account"
  | "reset_password"
  | "deactivate_account"
  | "activate_account"
  | "create_course"
  | "update_course"
  | "delete_course"
  | "update_course_cpmk";

export type AuditEntity = "faculty" | "study_program" | "admin_user" | "course";

/** Nilai sebelum/sesudah per field, sudah dinormalkan untuk perbandingan. */
export type FieldChanges = Record<string, { before: unknown; after: unknown }>;

/** Field yang isinya rahasia tidak boleh masuk jejak audit dalam bentuk apa pun. */
const NEVER_LOGGED = new Set(["password", "passwordHash", "password_hash", "temporary_password"]);

/**
 * Bandingkan dua objek dan kembalikan hanya field yang benar-benar berubah.
 * Array dan objek dibandingkan lewat bentuk JSON-nya supaya perubahan urutan
 * ikut terdeteksi — urutan misi dan CPL bermakna di dokumen.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChanges {
  const changes: FieldChanges = {};
  for (const key of Object.keys(after)) {
    if (NEVER_LOGGED.has(key)) continue;
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    changes[key] = { before: a ?? null, after: b ?? null };
  }
  return changes;
}

export async function recordAudit(input: {
  actor: AdminIdentity;
  action: AuditAction;
  entity: AuditEntity;
  entityRef: string;
  entityLabel?: string | null;
  changes?: FieldChanges;
  ip?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actor.id,
        actorNidn: input.actor.nidn,
        actorName: input.actor.name,
        action: input.action,
        entity: input.entity,
        entityRef: input.entityRef,
        entityLabel: input.entityLabel ?? null,
        changes: JSON.stringify(input.changes ?? {}),
        ip: input.ip ?? null,
      },
    });
  } catch (e) {
    // Kegagalan mencatat jejak tidak boleh membatalkan perubahan yang sudah
    // tersimpan — pengguna akan melihat error padahal datanya sudah berubah.
    console.error("[audit] gagal mencatat:", e);
  }
}

export type AuditEntry = {
  id: number;
  actor_nidn: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_ref: string;
  entity_label: string | null;
  changes: FieldChanges;
  created_at: Date;
};

/**
 * Riwayat perubahan, dibatasi pada lingkup wewenang pembaca: super admin
 * melihat semuanya, admin fakultas hanya entitas di fakultasnya, kaprodi hanya
 * prodinya. Tanpa pembatasan ini, log audit menjadi celah kebocoran informasi
 * lintas fakultas.
 */
export async function listAudit(
  identity: AdminIdentity,
  limit = 50,
): Promise<AuditEntry[]> {
  const refs: string[] = [];
  if (identity.role === "faculty_admin" && identity.facultySlug) {
    const programs = await prisma.studyProgram.findMany({
      where: { facultyId: identity.facultyId },
      select: { slug: true },
    });
    refs.push(identity.facultySlug, ...programs.map((p) => p.slug));
  } else if (identity.role === "kaprodi" && identity.studyProgramSlug) {
    refs.push(identity.studyProgramSlug);
  }

  const rows = await prisma.auditLog.findMany({
    where: identity.role === "super_admin" ? {} : { entityRef: { in: refs.length ? refs : ["__none__"] } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });

  return rows.map((r) => ({
    id: r.id,
    actor_nidn: r.actorNidn,
    actor_name: r.actorName,
    action: r.action,
    entity: r.entity,
    entity_ref: r.entityRef,
    entity_label: r.entityLabel,
    changes: (() => {
      try { return JSON.parse(r.changes) as FieldChanges; } catch { return {}; }
    })(),
    created_at: r.createdAt,
  }));
}
