import { Hono } from "hono";
import type { Context, Next } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Buffer } from "node:buffer";
import { prisma } from "./src/lib/db";
import { encrypt, decrypt, keyHint } from "./src/lib/crypto";
import { rpsCreateSchema, adminLoginSchema, adminChangePasswordSchema, studyProgramUpdateSchema, studyProgramCplSchema, facultyUpdateSchema, accountCreateSchema, accountUpdateSchema, courseCreateSchema, courseUpdateSchema, courseCpmkSchema } from "./src/lib/zod";
import { auditDraft } from "./src/lib/audit";
import {
  SESSION_COOKIE, SESSION_TTL_HOURS, LOCKOUT_MINUTES,
  login as adminLogin, resolveSession, destroySession, destroyAllSessions,
  changePassword, verifyPassword, canManageFaculty, canManageProgram, canManageAccounts,
  hashPassword, generateTemporaryPassword, isValidNidn,
  type AdminIdentity,
} from "./src/lib/auth";
import { recordAudit, diffFields, listAudit } from "./src/lib/audit-log";

type AppEnv = { Variables: { admin: AdminIdentity } };
const app = new Hono<AppEnv>();

/**
 * CORS dibatasi allowlist dan mengizinkan credential, karena sesi admin
 * memakai cookie. Wildcard `*` tidak boleh dikombinasikan dengan
 * `credentials: true` — browser menolaknya, dan seandainya bisa, situs mana
 * pun akan dapat memanggil endpoint admin memakai cookie korban.
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
  .split(",").map((s) => s.trim()).filter(Boolean);
app.use("/*", cors({
  origin: (origin) => (!origin || ALLOWED_ORIGINS.includes(origin) ? origin ?? ALLOWED_ORIGINS[0] : null),
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type"],
}));

const isProduction = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Rate limit sederhana in-memory untuk endpoint login.
// Lockout per-akun saja tidak cukup: penyerang bisa merotasi NIDN untuk
// menghindarinya. Pembatas per-IP ini menutup celah itu. Cukup untuk deployment
// satu proses; kalau nanti multi-instance, pindahkan ke store bersama.
// ---------------------------------------------------------------------------
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_WINDOW = 20;
const loginHits = new Map<string, { count: number; resetAt: number }>();

/**
 * `X-Forwarded-For` hanya dipercaya bila aplikasi memang berada di belakang
 * reverse proxy (`TRUST_PROXY=true`). Kalau server terekspos langsung,
 * memercayai header ini berarti siapa pun bisa memalsukannya untuk mendapat
 * kuota rate limit baru pada setiap request.
 */
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

function clientIp(c: Context): string {
  if (TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
    const real = c.req.header("x-real-ip")?.trim();
    if (real) return real;
  }
  // Bun menyediakan alamat remote lewat info koneksi server.
  const conn = c.env as { requestIP?: (req: Request) => { address?: string } | null } | undefined;
  return conn?.requestIP?.(c.req.raw)?.address ?? "unknown";
}

function rateLimitLogin(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = loginHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginHits.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX_PER_WINDOW) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

// Bersihkan entri kedaluwarsa agar map tidak tumbuh tanpa batas.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginHits) if (entry.resetAt <= now) loginHits.delete(ip);
}, LOGIN_WINDOW_MS).unref?.();

/** Dipakai test: menyetel ulang kuota agar setiap kasus mulai dari kondisi bersih. */
export function __resetLoginRateLimit() {
  loginHits.clear();
}

/** Tolak request tanpa sesi admin yang sah. */
async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const identity = await resolveSession(getCookie(c, SESSION_COOKIE));
  if (!identity) {
    return c.json({ success: false, error: "unauthorized", message: "Sesi tidak valid atau sudah berakhir. Silakan login." }, 401);
  }
  c.set("admin", identity);
  await next();
}

/**
 * Admin yang wajib ganti password hanya boleh mengakses endpoint sesi dan
 * penggantian password — bukan mutasi master data.
 */
function blockIfMustChangePassword(c: Context<AppEnv>) {
  const admin = c.get("admin");
  if (admin.mustChangePassword) {
    return c.json({ success: false, error: "password_change_required", message: "Ganti password dulu sebelum mengelola data." }, 403);
  }
  return null;
}

/** Batas wewenang dalam bahasa yang bisa dipahami pengguna. */
function scopeMessage(admin: AdminIdentity): string {
  if (admin.role === "kaprodi") {
    return `Anda hanya berwenang atas ${admin.studyProgramLabel ?? "program studi Anda"}.`;
  }
  return `Anda hanya berwenang atas ${admin.facultyLabel ?? "fakultas Anda"}.`;
}

/** Tolak request dari akun yang bukan super admin. */
async function requireSuperAdmin(c: Context<AppEnv>, next: Next) {
  const admin = c.get("admin");
  if (!canManageAccounts(admin)) {
    return c.json({
      success: false, error: "forbidden",
      message: "Hanya Super Admin yang boleh mengelola akun.",
    }, 403);
  }
  await next();
}

function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,       // tidak terbaca JavaScript — membatasi dampak XSS
    sameSite: "Lax",      // menahan CSRF lintas situs untuk request state-changing
    secure: isProduction, // di dev lewat http://localhost, cookie Secure tidak akan terkirim
    path: "/",
    maxAge: SESSION_TTL_HOURS * 60 * 60,
  });
}

app.get("/api/health", async (c) => {
  try { await prisma.$queryRaw`SELECT 1`; return c.json({ success: true, data: { db: "ok", version: "2.0-simple" } }); }
  catch (e) { return c.json({ success: false, error: "db_error" }, 500); }
});

// ---------------------------------------------------------------------------
// Admin: sesi
// ---------------------------------------------------------------------------
app.post("/api/admin/login", async (c) => {
  const ip = clientIp(c);
  const limit = rateLimitLogin(ip);
  if (!limit.allowed) {
    return c.json({
      success: false, error: "rate_limited",
      message: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(limit.retryAfterSeconds / 60)} menit.`,
    }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }

  const result = await adminLogin(parsed.data.nidn, parsed.data.password, {
    ip, userAgent: c.req.header("user-agent") ?? null,
  });

  if (!result.ok) {
    if (result.failure.kind === "locked") {
      return c.json({
        success: false, error: "account_locked",
        message: `Akun terkunci sementara karena percobaan gagal berulang. Coba lagi dalam ${Math.ceil(result.failure.retryAfterSeconds / 60)} menit.`,
      }, 423, { "Retry-After": String(result.failure.retryAfterSeconds) });
    }
    if (result.failure.kind === "inactive") {
      return c.json({ success: false, error: "account_inactive", message: "Akun ini sudah dinonaktifkan." }, 403);
    }
    // Pesan sengaja tidak membedakan "NIDN tidak terdaftar" dari "password
    // salah": pembedaan itu memberi penyerang daftar NIDN yang valid.
    return c.json({
      success: false, error: "invalid_credentials",
      message: `NIDN atau password salah. Setelah beberapa percobaan gagal, akun terkunci ${LOCKOUT_MINUTES} menit.`,
    }, 401);
  }

  setSessionCookie(c, result.session.id);
  return c.json({ success: true, data: result.identity, message: `Selamat datang, ${result.identity.name}.` });
});

app.post("/api/admin/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ success: true, data: { loggedOut: true } });
});

app.get("/api/admin/me", async (c) => {
  const identity = await resolveSession(getCookie(c, SESSION_COOKIE));
  if (!identity) return c.json({ success: false, error: "unauthorized", message: "Belum login." }, 401);
  return c.json({ success: true, data: identity });
});

app.post("/api/admin/change-password", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const body = await c.req.json().catch(() => ({}));
  const parsed = adminChangePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }
  const row = await prisma.adminUser.findUnique({ where: { id: admin.id } });
  if (!row) return c.json({ success: false, message: "Akun tidak ditemukan" }, 404);
  if (!(await verifyPassword(parsed.data.current_password, row.passwordHash))) {
    return c.json({ success: false, error: "invalid_credentials", message: "Password saat ini salah." }, 401);
  }
  // Mencabut semua sesi termasuk yang sedang dipakai — pemanggil harus login ulang.
  await changePassword(admin.id, parsed.data.new_password);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ success: true, data: { changed: true }, message: "Password diganti. Silakan login ulang." });
});

// ---------------------------------------------------------------------------
// Admin: master data prodi
// ---------------------------------------------------------------------------

/** Prodi yang boleh dikelola admin ini. */
app.get("/api/admin/programs", requireAdmin, async (c) => {
  const admin = c.get("admin");
  // Kaprodi hanya melihat prodinya sendiri; admin fakultas seluruh prodi di
  // fakultasnya; super admin semuanya.
  const scope =
    admin.role === "super_admin" ? {}
    : admin.role === "kaprodi" ? { id: admin.studyProgramId ?? -1 }
    : { facultyId: admin.facultyId ?? -1 };
  const rows = await prisma.studyProgram.findMany({
    where: scope,
    orderBy: [{ facultyLabel: "asc" }, { label: "asc" }],
    include: { faculty: true },
  });
  const parse = (s: string) => { try { return JSON.parse(s) as unknown[]; } catch { return []; } };
  return c.json({
    success: true,
    data: rows.map((p) => ({
      slug: p.slug, label: p.label, value: p.value,
      faculty_label: p.faculty?.label ?? p.facultyLabel,
      faculty_slug: p.faculty?.slug ?? p.facultySlug,
      akreditasi: p.akreditasi, completeness: p.completeness,
      vision: p.vision,
      mission: parse(p.mission),
      objective: parse(p.objective),
      graduate_profile: parse(p.graduateProfile),
      cpl: parse(p.cpl),
      updated_at: p.updatedAt,
    })),
  });
});

app.put("/api/admin/programs/:slug", requireAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const slug = c.req.param("slug");
  const program = await prisma.studyProgram.findUnique({ where: { slug } });
  if (!program) return c.json({ success: false, message: "Program studi tidak ditemukan" }, 404);

  // Otorisasi memakai id relasi, bukan pencocokan label: perbandingan string
  // rapuh terhadap selisih spasi/kapitalisasi, dan di jalur otorisasi
  // kerapuhan itu berarti akses yang jebol.
  if (!canManageProgram(admin, program)) {
    return c.json({ success: false, error: "forbidden", message: scopeMessage(admin) }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = studyProgramUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }

  const patch: Record<string, unknown> = {};
  if ("vision" in parsed.data) patch.vision = parsed.data.vision ?? null;
  if (parsed.data.mission) patch.mission = JSON.stringify(parsed.data.mission);
  if (parsed.data.objective) patch.objective = JSON.stringify(parsed.data.objective);
  if (parsed.data.graduate_profile) patch.graduateProfile = JSON.stringify(parsed.data.graduate_profile);

  const updated = await prisma.studyProgram.update({ where: { slug }, data: patch });
  const parse = (s: string) => { try { return JSON.parse(s) as unknown[]; } catch { return []; } };

  await recordAudit({
    actor: admin, action: "update_program_profile", entity: "study_program",
    entityRef: updated.slug, entityLabel: updated.label, ip: clientIp(c),
    changes: diffFields(
      { vision: program.vision, mission: parse(program.mission), objective: parse(program.objective), graduate_profile: parse(program.graduateProfile) },
      { vision: updated.vision, mission: parse(updated.mission), objective: parse(updated.objective), graduate_profile: parse(updated.graduateProfile) },
    ),
  });

  return c.json({
    success: true,
    data: {
      slug: updated.slug, label: updated.label,
      vision: updated.vision,
      mission: parse(updated.mission),
      objective: parse(updated.objective),
      graduate_profile: parse(updated.graduateProfile),
      updated_at: updated.updatedAt,
    },
    message: `Profil ${updated.label} tersimpan.`,
  });
});

/**
 * CPL prodi dikelola terpisah dari profil karena bentuknya berbeda: daftar
 * objek berkode, bukan baris teks. Memisahkan endpoint juga membuat panel
 * profil tidak berisiko menimpa CPL (dan sebaliknya) saat menyimpan sebagian.
 */
app.put("/api/admin/programs/:slug/cpl", requireAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const slug = c.req.param("slug");
  const program = await prisma.studyProgram.findUnique({ where: { slug } });
  if (!program) return c.json({ success: false, message: "Program studi tidak ditemukan" }, 404);
  if (!canManageProgram(admin, program)) {
    return c.json({ success: false, error: "forbidden", message: scopeMessage(admin) }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = studyProgramCplSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }

  // `category` disimpan sebagai null bila tidak diisi, bukan dihilangkan,
  // supaya bentuk tiap item konsisten saat dibaca kembali.
  const normalised = parsed.data.cpl.map((item) => ({
    code: item.code,
    description: item.description,
    category: item.category ?? null,
  }));

  const updated = await prisma.studyProgram.update({
    where: { slug },
    data: { cpl: JSON.stringify(normalised) },
  });

  const previousCpl = (() => { try { return JSON.parse(program.cpl) as unknown[]; } catch { return []; } })();
  await recordAudit({
    actor: admin, action: "update_program_cpl", entity: "study_program",
    entityRef: updated.slug, entityLabel: updated.label, ip: clientIp(c),
    changes: diffFields({ cpl: previousCpl }, { cpl: normalised }),
  });

  return c.json({
    success: true,
    data: { slug: updated.slug, label: updated.label, cpl: normalised, updated_at: updated.updatedAt },
    message: `CPL ${updated.label} tersimpan (${normalised.length} butir).`,
  });
});

// ---------------------------------------------------------------------------
// Admin: profil fakultas
// ---------------------------------------------------------------------------
app.get("/api/admin/faculties", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const rows = await prisma.faculty.findMany({
    where: admin.role === "super_admin" ? {} : { id: admin.facultyId ?? -1 },
    orderBy: { id: "asc" },
    include: { _count: { select: { programs: true } } },
  });
  const parse = (s: string) => { try { return JSON.parse(s) as unknown[]; } catch { return []; } };
  return c.json({
    success: true,
    data: rows.map((f) => ({
      slug: f.slug, label: f.label, href: f.href,
      vision: f.vision,
      mission: parse(f.mission),
      objective: parse(f.objective),
      program_count: f._count.programs,
      updated_at: f.updatedAt,
    })),
  });
});

app.put("/api/admin/faculties/:slug", requireAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const slug = c.req.param("slug");
  const faculty = await prisma.faculty.findUnique({ where: { slug } });
  if (!faculty) return c.json({ success: false, message: "Fakultas tidak ditemukan" }, 404);
  if (!canManageFaculty(admin, faculty.id)) {
    return c.json({
      success: false, error: "forbidden",
      message: `Anda hanya berwenang atas ${admin.facultyLabel ?? "fakultas Anda"}.`,
    }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = facultyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }

  const patch: Record<string, unknown> = {};
  if ("vision" in parsed.data) patch.vision = parsed.data.vision ?? null;
  if (parsed.data.mission) patch.mission = JSON.stringify(parsed.data.mission);
  if (parsed.data.objective) patch.objective = JSON.stringify(parsed.data.objective);

  const updated = await prisma.faculty.update({ where: { slug }, data: patch });
  const parse = (s: string) => { try { return JSON.parse(s) as unknown[]; } catch { return []; } };

  await recordAudit({
    actor: admin, action: "update_faculty_profile", entity: "faculty",
    entityRef: updated.slug, entityLabel: updated.label, ip: clientIp(c),
    changes: diffFields(
      { vision: faculty.vision, mission: parse(faculty.mission), objective: parse(faculty.objective) },
      { vision: updated.vision, mission: parse(updated.mission), objective: parse(updated.objective) },
    ),
  });

  return c.json({
    success: true,
    data: {
      slug: updated.slug, label: updated.label,
      vision: updated.vision,
      mission: parse(updated.mission),
      objective: parse(updated.objective),
      updated_at: updated.updatedAt,
    },
    message: `Profil ${updated.label} tersimpan.`,
  });
});

// ---------------------------------------------------------------------------
// Super admin: manajemen akun (termasuk pembuatan akun kaprodi)
// ---------------------------------------------------------------------------

/** Bentuk akun untuk panel — tanpa hash password dalam bentuk apa pun. */
function accountView(row: {
  id: number; nidn: string; name: string; role: string; isActive: boolean;
  mustChangePassword: boolean; lastLoginAt: Date | null; lockedUntil: Date | null;
  createdAt: Date;
  faculty?: { label: string; slug: string } | null;
  studyProgram?: { label: string; slug: string } | null;
}) {
  return {
    id: row.id,
    nidn: row.nidn,
    name: row.name,
    role: row.role,
    faculty_label: row.faculty?.label ?? null,
    faculty_slug: row.faculty?.slug ?? null,
    study_program_label: row.studyProgram?.label ?? null,
    study_program_slug: row.studyProgram?.slug ?? null,
    is_active: row.isActive,
    must_change_password: row.mustChangePassword,
    is_locked: !!row.lockedUntil && row.lockedUntil.getTime() > Date.now(),
    last_login_at: row.lastLoginAt,
    created_at: row.createdAt,
  };
}

const ACCOUNT_INCLUDE = {
  faculty: { select: { label: true, slug: true } },
  studyProgram: { select: { label: true, slug: true } },
} as const;

app.get("/api/admin/accounts", requireAdmin, requireSuperAdmin, async (c) => {
  const rows = await prisma.adminUser.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    include: ACCOUNT_INCLUDE,
  });
  return c.json({ success: true, data: rows.map(accountView) });
});

/**
 * Buat akun baru (kaprodi / admin fakultas / super admin).
 *
 * Password sementara dibuat sistem dan hanya dikembalikan sekali di respons
 * ini; yang tersimpan cuma hash-nya. Super admin menyerahkannya lewat kanal
 * terpisah, dan pemilik akun wajib menggantinya saat login pertama.
 */
app.post("/api/admin/accounts", requireAdmin, requireSuperAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const body = await c.req.json().catch(() => ({}));
  const parsed = accountCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }
  const { nidn, name, role } = parsed.data;

  if (await prisma.adminUser.findUnique({ where: { nidn } })) {
    return c.json({
      success: false, error: "duplicate_nidn",
      message: `NIDN ${nidn} sudah terdaftar.`,
      errors: { nidn: ["NIDN sudah terdaftar"] },
    }, 409);
  }

  // Lingkup diturunkan dari slug: prodi menentukan fakultasnya sendiri supaya
  // tidak mungkin ada kaprodi yang terdaftar di fakultas yang bukan induk
  // prodinya.
  let facultyId: number | null = null;
  let studyProgramId: number | null = null;
  let scopeLabel = "seluruh universitas";

  if (role === "kaprodi") {
    const program = await prisma.studyProgram.findUnique({
      where: { slug: parsed.data.study_program_slug! },
      include: { faculty: { select: { id: true, label: true } } },
    });
    if (!program) {
      return c.json({ success: false, message: "Program studi tidak ditemukan", errors: { study_program_slug: ["Tidak ditemukan"] } }, 422);
    }
    studyProgramId = program.id;
    facultyId = program.facultyId;
    scopeLabel = `${program.label} (${program.faculty?.label ?? "-"})`;
  } else if (role === "faculty_admin") {
    const faculty = await prisma.faculty.findUnique({ where: { slug: parsed.data.faculty_slug! } });
    if (!faculty) {
      return c.json({ success: false, message: "Fakultas tidak ditemukan", errors: { faculty_slug: ["Tidak ditemukan"] } }, 422);
    }
    facultyId = faculty.id;
    scopeLabel = faculty.label;
  }

  const temporaryPassword = generateTemporaryPassword();
  const created = await prisma.adminUser.create({
    data: {
      nidn, name, role, facultyId, studyProgramId,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    },
    include: ACCOUNT_INCLUDE,
  });

  await recordAudit({
    actor: admin, action: "create_account", entity: "admin_user",
    entityRef: created.nidn, entityLabel: created.name, ip: clientIp(c),
    changes: { role: { before: null, after: role }, scope: { before: null, after: scopeLabel } },
  });

  return c.json({
    success: true,
    data: {
      account: accountView(created),
      // Satu-satunya kesempatan membaca password ini.
      temporary_password: temporaryPassword,
    },
    message: `Akun ${created.name} dibuat. Serahkan password sementara ini sekarang — tidak bisa dilihat lagi.`,
  }, 201);
});

app.put("/api/admin/accounts/:nidn", requireAdmin, requireSuperAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const nidn = c.req.param("nidn");
  const target = await prisma.adminUser.findUnique({ where: { nidn }, include: ACCOUNT_INCLUDE });
  if (!target) return c.json({ success: false, message: "Akun tidak ditemukan" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const parsed = accountUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }

  // Mencegah super admin mengunci dirinya sendiri: menonaktifkan atau
  // menurunkan peran akun sendiri bisa menyisakan sistem tanpa siapa pun yang
  // berwenang membuat akun.
  if (target.id === admin.id) {
    if (parsed.data.is_active === false) {
      return c.json({ success: false, error: "self_lockout", message: "Anda tidak bisa menonaktifkan akun sendiri." }, 422);
    }
    if (parsed.data.role && parsed.data.role !== "super_admin") {
      return c.json({ success: false, error: "self_lockout", message: "Anda tidak bisa menurunkan peran akun sendiri." }, 422);
    }
  }

  // Sistem harus selalu punya minimal satu super admin aktif.
  const losingSuperAdmin = target.role === "super_admin"
    && ((parsed.data.role && parsed.data.role !== "super_admin") || parsed.data.is_active === false);
  if (losingSuperAdmin) {
    const activeSuperAdmins = await prisma.adminUser.count({
      where: { role: "super_admin", isActive: true, id: { not: target.id } },
    });
    if (activeSuperAdmins === 0) {
      return c.json({
        success: false, error: "last_super_admin",
        message: "Ini satu-satunya Super Admin aktif. Buat penggantinya lebih dulu.",
      }, 422);
    }
  }

  const nextRole = parsed.data.role ?? (target.role as "super_admin" | "faculty_admin" | "kaprodi");
  const patch: Record<string, unknown> = {};
  if (parsed.data.name) patch.name = parsed.data.name;
  if (parsed.data.role) patch.role = parsed.data.role;
  if (typeof parsed.data.is_active === "boolean") patch.isActive = parsed.data.is_active;

  if ("study_program_slug" in parsed.data || "faculty_slug" in parsed.data || parsed.data.role) {
    if (nextRole === "kaprodi") {
      const slug = parsed.data.study_program_slug ?? target.studyProgram?.slug;
      if (!slug) {
        return c.json({ success: false, error: "validation_error", message: "Kaprodi wajib punya program studi", errors: { study_program_slug: ["Wajib diisi"] } }, 422);
      }
      const program = await prisma.studyProgram.findUnique({ where: { slug } });
      if (!program) return c.json({ success: false, message: "Program studi tidak ditemukan" }, 422);
      patch.studyProgramId = program.id;
      patch.facultyId = program.facultyId;
    } else if (nextRole === "faculty_admin") {
      const slug = parsed.data.faculty_slug ?? target.faculty?.slug;
      if (!slug) {
        return c.json({ success: false, error: "validation_error", message: "Admin fakultas wajib punya fakultas", errors: { faculty_slug: ["Wajib diisi"] } }, 422);
      }
      const faculty = await prisma.faculty.findUnique({ where: { slug } });
      if (!faculty) return c.json({ success: false, message: "Fakultas tidak ditemukan" }, 422);
      patch.facultyId = faculty.id;
      patch.studyProgramId = null;
    } else {
      patch.facultyId = null;
      patch.studyProgramId = null;
    }
  }

  const updated = await prisma.adminUser.update({ where: { nidn }, data: patch, include: ACCOUNT_INCLUDE });

  // Peran atau lingkup yang berubah harus berlaku seketika, bukan menunggu
  // sesi lama kedaluwarsa — sesi menyimpan wewenang saat login.
  const scopeChanged = updated.role !== target.role
    || updated.facultyId !== target.facultyId
    || updated.studyProgramId !== target.studyProgramId
    || updated.isActive !== target.isActive;
  if (scopeChanged) await destroyAllSessions(updated.id);

  await recordAudit({
    actor: admin, action: parsed.data.is_active === false ? "deactivate_account" : "update_account",
    entity: "admin_user", entityRef: updated.nidn, entityLabel: updated.name, ip: clientIp(c),
    changes: diffFields(
      { name: target.name, role: target.role, is_active: target.isActive, faculty: target.faculty?.slug ?? null, study_program: target.studyProgram?.slug ?? null },
      { name: updated.name, role: updated.role, is_active: updated.isActive, faculty: updated.faculty?.slug ?? null, study_program: updated.studyProgram?.slug ?? null },
    ),
  });

  return c.json({
    success: true,
    data: accountView(updated),
    message: scopeChanged
      ? `Akun ${updated.name} diperbarui. Sesi aktifnya diakhiri agar wewenang baru langsung berlaku.`
      : `Akun ${updated.name} diperbarui.`,
  });
});

/** Reset password: terbitkan password sementara baru dan cabut semua sesi. */
app.post("/api/admin/accounts/:nidn/reset-password", requireAdmin, requireSuperAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const nidn = c.req.param("nidn");
  if (!isValidNidn(nidn)) return c.json({ success: false, message: "NIDN tidak valid" }, 422);

  const target = await prisma.adminUser.findUnique({ where: { nidn } });
  if (!target) return c.json({ success: false, message: "Akun tidak ditemukan" }, 404);

  const temporaryPassword = generateTemporaryPassword();
  await prisma.adminUser.update({
    where: { nidn },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  await destroyAllSessions(target.id);

  await recordAudit({
    actor: admin, action: "reset_password", entity: "admin_user",
    entityRef: target.nidn, entityLabel: target.name, ip: clientIp(c),
    // Password apa pun, lama maupun baru, tidak pernah masuk jejak audit.
    changes: { password: { before: "(dirahasiakan)", after: "(direset)" } },
  });

  return c.json({
    success: true,
    data: { nidn: target.nidn, name: target.name, temporary_password: temporaryPassword },
    message: `Password ${target.name} direset. Serahkan sekarang — tidak bisa dilihat lagi.`,
  });
});

// ---------------------------------------------------------------------------
// Bank kurikulum: mata kuliah + CPMK + Sub-CPMK
//
// CPL dimiliki program studi; CPMK adalah capaian sebuah mata kuliah yang
// memetakan ke CPL. Memisahkannya ke sini membuat CPMK bisa dipakai ulang oleh
// setiap RPS dan bisa diperiksa konsistensinya terhadap CPL prodi.
// ---------------------------------------------------------------------------

const parseJsonArray = (raw: string | null | undefined): unknown[] => {
  try { return raw ? JSON.parse(raw) as unknown[] : []; } catch { return []; }
};

type CpmkRow = {
  id: number; code: string; description: string; taxonomy: string | null; cplCode: string | null; ordering: number;
  subCpmks: { id: number; code: string; description: string; taxonomy: string | null; ordering: number }[];
};

function cpmkView(rows: CpmkRow[]) {
  return rows.map((cpmk) => ({
    code: cpmk.code,
    description: cpmk.description,
    taxonomy: cpmk.taxonomy,
    cpl_code: cpmk.cplCode,
    sub_cpmk: cpmk.subCpmks.map((sub) => ({
      code: sub.code, description: sub.description, taxonomy: sub.taxonomy,
    })),
  }));
}

const COURSE_INCLUDE = {
  cpmks: { orderBy: { ordering: "asc" }, include: { subCpmks: { orderBy: { ordering: "asc" } } } },
  studyProgram: { select: { slug: true, label: true, facultyLabel: true } },
} as const;

function courseView(row: {
  id: number; code: string; name: string; cluster: string | null; semester: number;
  sksTheory: number; sksPractice: number; isElective: boolean; description: string | null;
  bahanKajian: string; pustakaUtama: string; pustakaPendukung: string; updatedAt: Date;
  cpmks: CpmkRow[];
  studyProgram?: { slug: string; label: string; facultyLabel: string } | null;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    cluster: row.cluster,
    semester: row.semester,
    sks_theory: row.sksTheory,
    sks_practice: row.sksPractice,
    sks_total: row.sksTheory + row.sksPractice,
    is_elective: row.isElective,
    description: row.description,
    bahan_kajian: parseJsonArray(row.bahanKajian),
    pustaka_utama: parseJsonArray(row.pustakaUtama),
    pustaka_pendukung: parseJsonArray(row.pustakaPendukung),
    study_program_slug: row.studyProgram?.slug ?? null,
    study_program_label: row.studyProgram?.label ?? null,
    faculty_label: row.studyProgram?.facultyLabel ?? null,
    cpmk: cpmkView(row.cpmks),
    cpmk_count: row.cpmks.length,
    sub_cpmk_count: row.cpmks.reduce((n, c) => n + c.subCpmks.length, 0),
    updated_at: row.updatedAt,
  };
}

/** Prodi yang boleh disentuh admin ini, sebagai klausa `where` Prisma. */
function programScope(admin: AdminIdentity) {
  if (admin.role === "super_admin") return {};
  if (admin.role === "kaprodi") return { id: admin.studyProgramId ?? -1 };
  return { facultyId: admin.facultyId ?? -1 };
}

/** Ambil prodi sekaligus periksa wewenang; mengembalikan respons error bila ditolak. */
async function resolveProgramForAdmin(c: Context<AppEnv>, slug: string | undefined) {
  const admin = c.get("admin");
  if (!slug) {
    return { error: c.json({ success: false, message: "Program studi wajib disebut" }, 422) };
  }
  const program = await prisma.studyProgram.findUnique({ where: { slug } });
  if (!program) {
    return { error: c.json({ success: false, message: "Program studi tidak ditemukan" }, 404) };
  }
  if (!canManageProgram(admin, program)) {
    return { error: c.json({ success: false, error: "forbidden", message: scopeMessage(admin) }, 403) };
  }
  return { program };
}

app.get("/api/admin/courses", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const slug = c.req.query("study_program_slug");
  const rows = await prisma.course.findMany({
    where: {
      studyProgram: slug ? { slug, ...programScope(admin) } : programScope(admin),
    },
    orderBy: [{ semester: "asc" }, { code: "asc" }],
    include: COURSE_INCLUDE,
  });
  return c.json({ success: true, data: rows.map(courseView) });
});

app.post("/api/admin/courses", requireAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const body = await c.req.json().catch(() => ({}));
  const parsed = courseCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }

  const resolved = await resolveProgramForAdmin(c, parsed.data.study_program_slug);
  if ("error" in resolved) return resolved.error;
  const program = resolved.program;

  const duplicate = await prisma.course.findFirst({
    where: { studyProgramId: program.id, code: parsed.data.code },
  });
  if (duplicate) {
    return c.json({
      success: false, error: "duplicate_code",
      message: `Kode ${parsed.data.code} sudah dipakai di ${program.label}.`,
      errors: { code: ["Kode sudah dipakai di prodi ini"] },
    }, 409);
  }

  const created = await prisma.course.create({
    data: {
      studyProgramId: program.id,
      code: parsed.data.code,
      name: parsed.data.name,
      cluster: parsed.data.cluster ?? program.label,
      semester: parsed.data.semester,
      sksTheory: parsed.data.sks_theory,
      sksPractice: parsed.data.sks_practice,
      isElective: parsed.data.is_elective ?? false,
      description: parsed.data.description ?? null,
      bahanKajian: JSON.stringify(parsed.data.bahan_kajian ?? []),
      pustakaUtama: JSON.stringify(parsed.data.pustaka_utama ?? []),
      pustakaPendukung: JSON.stringify(parsed.data.pustaka_pendukung ?? []),
    },
    include: COURSE_INCLUDE,
  });

  await recordAudit({
    actor: admin, action: "create_course", entity: "course",
    entityRef: `${program.slug}/${created.code}`, entityLabel: created.name, ip: clientIp(c),
    changes: { code: { before: null, after: created.code }, name: { before: null, after: created.name } },
  });

  return c.json({ success: true, data: courseView(created), message: `Mata kuliah ${created.code} ditambahkan.` }, 201);
});

/** Muat course sekaligus periksa wewenang lewat prodi induknya. */
async function resolveCourseForAdmin(c: Context<AppEnv>, id: number) {
  const admin = c.get("admin");
  const course = await prisma.course.findUnique({
    where: { id },
    include: { ...COURSE_INCLUDE, studyProgram: true },
  });
  if (!course) {
    return { error: c.json({ success: false, message: "Mata kuliah tidak ditemukan" }, 404) };
  }
  if (!canManageProgram(admin, course.studyProgram)) {
    return { error: c.json({ success: false, error: "forbidden", message: scopeMessage(admin) }, 403) };
  }
  return { course };
}

app.put("/api/admin/courses/:id", requireAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ success: false, message: "Id tidak valid" }, 422);

  const resolved = await resolveCourseForAdmin(c, id);
  if ("error" in resolved) return resolved.error;
  const course = resolved.course;

  const body = await c.req.json().catch(() => ({}));
  const parsed = courseUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }

  if (parsed.data.code && parsed.data.code !== course.code) {
    const clash = await prisma.course.findFirst({
      where: { studyProgramId: course.studyProgramId, code: parsed.data.code, id: { not: course.id } },
    });
    if (clash) {
      return c.json({ success: false, error: "duplicate_code", message: `Kode ${parsed.data.code} sudah dipakai di prodi ini.`, errors: { code: ["Kode sudah dipakai"] } }, 409);
    }
  }

  const theory = parsed.data.sks_theory ?? course.sksTheory;
  const practice = parsed.data.sks_practice ?? course.sksPractice;
  if (theory + practice <= 0) {
    return c.json({ success: false, error: "validation_error", message: "Total SKS harus lebih dari 0", errors: { sks_theory: ["Total SKS harus > 0"] } }, 422);
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.code) patch.code = parsed.data.code;
  if (parsed.data.name) patch.name = parsed.data.name;
  if ("cluster" in parsed.data) patch.cluster = parsed.data.cluster ?? null;
  if (parsed.data.semester) patch.semester = parsed.data.semester;
  if (parsed.data.sks_theory !== undefined) patch.sksTheory = parsed.data.sks_theory;
  if (parsed.data.sks_practice !== undefined) patch.sksPractice = parsed.data.sks_practice;
  if (parsed.data.is_elective !== undefined) patch.isElective = parsed.data.is_elective;
  if ("description" in parsed.data) patch.description = parsed.data.description ?? null;
  if (parsed.data.bahan_kajian) patch.bahanKajian = JSON.stringify(parsed.data.bahan_kajian);
  if (parsed.data.pustaka_utama) patch.pustakaUtama = JSON.stringify(parsed.data.pustaka_utama);
  if (parsed.data.pustaka_pendukung) patch.pustakaPendukung = JSON.stringify(parsed.data.pustaka_pendukung);

  const updated = await prisma.course.update({ where: { id }, data: patch, include: COURSE_INCLUDE });

  await recordAudit({
    actor: admin, action: "update_course", entity: "course",
    entityRef: `${course.studyProgram.slug}/${updated.code}`, entityLabel: updated.name, ip: clientIp(c),
    changes: diffFields(
      { code: course.code, name: course.name, semester: course.semester, sks_theory: course.sksTheory, sks_practice: course.sksPractice, description: course.description },
      { code: updated.code, name: updated.name, semester: updated.semester, sks_theory: updated.sksTheory, sks_practice: updated.sksPractice, description: updated.description },
    ),
  });

  return c.json({ success: true, data: courseView(updated), message: `Mata kuliah ${updated.code} tersimpan.` });
});

app.delete("/api/admin/courses/:id", requireAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ success: false, message: "Id tidak valid" }, 422);

  const resolved = await resolveCourseForAdmin(c, id);
  if ("error" in resolved) return resolved.error;
  const course = resolved.course;

  // CPMK dan Sub-CPMK ikut terhapus lewat cascade di skema.
  await prisma.course.delete({ where: { id } });

  await recordAudit({
    actor: admin, action: "delete_course", entity: "course",
    entityRef: `${course.studyProgram.slug}/${course.code}`, entityLabel: course.name, ip: clientIp(c),
    changes: { code: { before: course.code, after: null } },
  });

  return c.json({ success: true, data: { deleted: true }, message: `Mata kuliah ${course.code} dihapus.` });
});

/**
 * Ganti seluruh daftar CPMK (beserta Sub-CPMK) sebuah mata kuliah.
 *
 * Diganti utuh, bukan ditambal per baris: urutan CPMK bermakna di dokumen RPS,
 * dan penggantian menyeluruh membuat urutan yang dikirim panel selalu menjadi
 * urutan yang tersimpan.
 */
app.put("/api/admin/courses/:id/cpmk", requireAdmin, async (c) => {
  const blocked = blockIfMustChangePassword(c);
  if (blocked) return blocked;

  const admin = c.get("admin");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ success: false, message: "Id tidak valid" }, 422);

  const resolved = await resolveCourseForAdmin(c, id);
  if ("error" in resolved) return resolved.error;
  const course = resolved.course;

  const body = await c.req.json().catch(() => ({}));
  const parsed = courseCpmkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  }

  // CPMK yang menunjuk CPL tidak ada membuat matriks pemetaan menyesatkan,
  // jadi kode CPL diperiksa terhadap CPL prodi yang tersimpan.
  const programCpl = parseJsonArray(course.studyProgram.cpl) as { code?: string }[];
  const validCplCodes = new Set(programCpl.map((x) => String(x.code ?? "").toUpperCase()).filter(Boolean));
  const unknownCpl = parsed.data.cpmk
    .map((x) => x.cpl_code?.trim())
    .filter((code): code is string => !!code)
    .filter((code) => !validCplCodes.has(code.toUpperCase()));
  if (unknownCpl.length) {
    return c.json({
      success: false, error: "unknown_cpl",
      message: `CPL ${[...new Set(unknownCpl)].join(", ")} tidak ada di ${course.studyProgram.label}. Tambahkan dulu di tab CPL Prodi.`,
      errors: { cpmk: [`CPL tidak dikenal: ${[...new Set(unknownCpl)].join(", ")}`] },
    }, 422);
  }

  const before = cpmkView(course.cpmks);

  await prisma.$transaction(async (tx) => {
    await tx.cpmk.deleteMany({ where: { courseId: id } });
    for (const [index, cpmk] of parsed.data.cpmk.entries()) {
      await tx.cpmk.create({
        data: {
          courseId: id,
          code: cpmk.code,
          description: cpmk.description,
          taxonomy: cpmk.taxonomy ?? null,
          cplCode: cpmk.cpl_code?.trim() || null,
          ordering: index,
          subCpmks: {
            create: (cpmk.sub_cpmk ?? []).map((sub, subIndex) => ({
              code: sub.code,
              description: sub.description,
              taxonomy: sub.taxonomy ?? null,
              ordering: subIndex,
            })),
          },
        },
      });
    }
  });

  const after = await prisma.course.findUniqueOrThrow({ where: { id }, include: COURSE_INCLUDE });

  await recordAudit({
    actor: admin, action: "update_course_cpmk", entity: "course",
    entityRef: `${course.studyProgram.slug}/${course.code}`, entityLabel: course.name, ip: clientIp(c),
    changes: diffFields({ cpmk: before }, { cpmk: cpmkView(after.cpmks) }),
  });

  return c.json({
    success: true,
    data: courseView(after),
    message: `CPMK ${course.code} tersimpan (${after.cpmks.length} CPMK).`,
  });
});

/**
 * Matriks pemetaan CPL x Profil Lulusan x CPMK.
 *
 * Tabel inilah yang biasa diminta asesor akreditasi: memperlihatkan CPL mana
 * yang belum ditopang mata kuliah apa pun, dan CPMK mana yang menggantung tanpa
 * CPL.
 */
app.get("/api/admin/programs/:slug/matrix", requireAdmin, async (c) => {
  const resolved = await resolveProgramForAdmin(c, c.req.param("slug"));
  if ("error" in resolved) return resolved.error;
  const program = resolved.program;

  const courses = await prisma.course.findMany({
    where: { studyProgramId: program.id },
    orderBy: [{ semester: "asc" }, { code: "asc" }],
    include: { cpmks: { orderBy: { ordering: "asc" }, include: { subCpmks: true } } },
  });

  const cplList = (parseJsonArray(program.cpl) as { code?: string; description?: string; category?: string | null }[])
    .map((x) => ({
      code: String(x.code ?? ""),
      description: String(x.description ?? ""),
      category: x.category ?? null,
    }))
    .filter((x) => x.code);

  const rows = cplList.map((cpl) => {
    const supporting = courses.flatMap((course) =>
      course.cpmks
        .filter((cpmk) => (cpmk.cplCode ?? "").toUpperCase() === cpl.code.toUpperCase())
        .map((cpmk) => ({
          course_id: course.id,
          course_code: course.code,
          course_name: course.name,
          semester: course.semester,
          cpmk_code: cpmk.code,
          cpmk_description: cpmk.description,
          taxonomy: cpmk.taxonomy,
          sub_cpmk_count: cpmk.subCpmks.length,
        })),
    );
    return { ...cpl, supporting, is_covered: supporting.length > 0 };
  });

  const orphanCpmk = courses.flatMap((course) =>
    course.cpmks
      .filter((cpmk) => !cpmk.cplCode
        || !cplList.some((cpl) => cpl.code.toUpperCase() === cpmk.cplCode!.toUpperCase()))
      .map((cpmk) => ({
        course_code: course.code, course_name: course.name,
        cpmk_code: cpmk.code, cpl_code: cpmk.cplCode,
      })),
  );

  return c.json({
    success: true,
    data: {
      study_program: { slug: program.slug, label: program.label, faculty_label: program.facultyLabel },
      graduate_profile: parseJsonArray(program.graduateProfile),
      cpl: rows,
      uncovered_cpl: rows.filter((r) => !r.is_covered).map((r) => r.code),
      orphan_cpmk: orphanCpmk,
      course_count: courses.length,
      cpmk_count: courses.reduce((n, x) => n + x.cpmks.length, 0),
    },
  });
});

/**
 * Bank kurikulum untuk pengisian RPS (publik, read-only).
 *
 * Alur pembuatan RPS belum berada di balik login, jadi endpoint ini dibuat
 * terbuka seperti `GET /api/programs`. Isinya memang bukan data sensitif —
 * kurikulum adalah informasi publik prodi.
 */
app.get("/api/courses", async (c) => {
  const slug = c.req.query("study_program_slug");
  const value = c.req.query("study_program");
  if (!slug && !value) {
    return c.json({ success: false, message: "Sertakan study_program_slug atau study_program" }, 422);
  }
  const rows = await prisma.course.findMany({
    where: { studyProgram: slug ? { slug } : { value } },
    orderBy: [{ semester: "asc" }, { code: "asc" }],
    include: COURSE_INCLUDE,
  });
  return c.json({ success: true, data: rows.map(courseView) });
});

// ---------------------------------------------------------------------------
// Riwayat perubahan (audit)
// ---------------------------------------------------------------------------
app.get("/api/admin/audit", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const limit = Number(c.req.query("limit") ?? 50);
  const entries = await listAudit(admin, Number.isFinite(limit) ? limit : 50);
  return c.json({ success: true, data: entries });
});

// ---------------------------------------------------------------------------
// Fakultas (publik, read-only) — dipakai dropdown form RPS supaya daftarnya
// mengikuti DB, bukan konstanta yang bisa menyimpang.
// ---------------------------------------------------------------------------
app.get("/api/faculties", async (c) => {
  const rows = await prisma.faculty.findMany({
    orderBy: { id: "asc" },
    include: { programs: { orderBy: { label: "asc" }, select: { label: true, value: true, slug: true, akreditasi: true } } },
  });
  const parse = (s: string) => { try { return JSON.parse(s) as unknown[]; } catch { return []; } };
  return c.json({
    success: true,
    data: rows.map((f) => ({
      slug: f.slug, label: f.label, href: f.href,
      vision: f.vision,
      mission: parse(f.mission),
      objective: parse(f.objective),
      programs: f.programs.map((p) => ({ slug: p.slug, label: p.label, value: p.value, akreditasi: p.akreditasi })),
    })),
  });
});

// Settings
app.get("/api/settings/api-keys", async (c) => {
  const rows = await prisma.apiKey.findMany({ orderBy: { provider: "asc" } });
  return c.json({ success: true, data: rows.map((r) => ({ provider: r.provider, keyHint: r.keyHint, isActive: r.isActive, updatedAt: r.updatedAt })) });
});

app.put("/api/settings/api-keys", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { provider, apiKey } = body as { provider?: string; apiKey?: string };
  if (!provider || !apiKey) return c.json({ success: false, error: "validation_error", message: "provider & apiKey required" }, 422);
  if (!["openai", "gemini", "claude"].includes(provider)) return c.json({ success: false, message: "provider invalid" }, 422);
  // format check — gemini longgarkan: terima AIza... maupun AQ.../Vertex & key panjang >=20 (tidak hard-require AIza)
  if (provider === "openai" && !/^sk-/.test(apiKey)) return c.json({ success: false, message: "Format key OpenAI harus sk-..." }, 422);
  if (provider === "gemini" && apiKey.trim().length < 20) return c.json({ success: false, message: "API key Gemini terlalu pendek (min 20 char)" }, 422);
  if (provider === "claude" && !/^sk-ant-/.test(apiKey)) return c.json({ success: false, message: "Format key Claude harus sk-ant-..." }, 422);
  const encrypted = encrypt(apiKey);
  const hint = keyHint(apiKey);
  const row = await prisma.apiKey.upsert({ where: { provider }, create: { provider, encryptedKey: encrypted, keyHint: hint }, update: { encryptedKey: encrypted, keyHint: hint, isActive: true } });
  return c.json({ success: true, data: { provider: row.provider, keyHint: row.keyHint, isActive: row.isActive }, message: "API key saved" });
});

app.post("/api/settings/api-keys/test", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { provider } = body as { provider?: string };
  if (!provider) return c.json({ success: false, message: "provider required" }, 422);
  const row = await prisma.apiKey.findUnique({ where: { provider } });
  if (!row) return c.json({ success: false, message: "No key set" }, 422);
  let key: string;
  try { key = decrypt(row.encryptedKey); } catch (e) { return c.json({ success: false, message: "Decrypt failed" }, 500); }
  try {
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return c.json({ success: true, data: { valid: false }, message: `Invalid key: ${r.status}` });
      const j = await r.json() as { data: { id: string }[] };
      return c.json({ success: true, data: { valid: true, models: j.data?.slice(0, 20).map((m) => m.id) ?? [] } });
    } else if (provider === "gemini") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
      if (!r.ok) return c.json({ success: true, data: { valid: false }, message: `Invalid key: ${r.status}` });
      const j = await r.json() as { models: { name: string }[] };
      return c.json({ success: true, data: { valid: true, models: (j.models ?? []).map((m) => m.name.split("/").pop()!) } });
    } else {
      return c.json({ success: true, data: { valid: true, models: [] } });
    }
  } catch (e) {
    return c.json({ success: false, message: "Provider error", error: String(e) }, 502);
  }
});

// RPS CRUD
app.get("/api/rps", async (c) => {
  const q = c.req.query("q") ?? "";
  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  const per_page = Math.min(50, Math.max(1, Number(c.req.query("per_page") ?? "15")));
  const where = q ? { OR: [{ courseName: { contains: q } }, { courseCode: { contains: q } }] } : {};
  const [total, rows] = await Promise.all([
    prisma.rpsDraft.count({ where }),
    prisma.rpsDraft.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * per_page, take: per_page }),
  ]);
  const data = rows.map((r) => ({ id: r.id, course_name: r.courseName, course_code: r.courseCode, semester: r.semester, status: r.status, updated_at: r.updatedAt }));
  return c.json({ success: true, data, pagination: { current_page: page, per_page, total, last_page: Math.ceil(total / per_page), from: (page - 1) * per_page + 1, to: Math.min(page * per_page, total) } });
});

app.post("/api/rps", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = rpsCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: "validation_error", message: "Validation failed", errors: parsed.error.flatten().fieldErrors }, 422);
  const d = parsed.data;
  const row = await prisma.rpsDraft.create({
    data: {
      courseName: d.course_name, courseCode: d.course_code, courseCluster: d.course_cluster ?? null,
      faculty: (d as { faculty?: string }).faculty ?? null,
      studyProgram: (d as { study_program?: string }).study_program ?? null,
      sksTotal: d.sks_total, sksTheory: d.sks_theory, sksPractice: d.sks_practice,
      semester: d.semester, preparationDate: new Date(d.preparation_date),
      lecturers: JSON.stringify(d.lecturers), cpl: JSON.stringify([]), cpmk: JSON.stringify([]), subCpmk: JSON.stringify([]),
      weeklyPlans: JSON.stringify([]), mediaMethods: JSON.stringify([]), status: "draft",
      ...(d.description ? { description: d.description } as never : {}),
      ...(((d as Record<string, unknown>).bahan_kajian) ? { bahanKajian: JSON.stringify((d as Record<string, unknown>).bahan_kajian) } as never : {}),
      ...(((d as Record<string, unknown>).pustaka_utama) ? { pustakaUtama: JSON.stringify((d as Record<string, unknown>).pustaka_utama) } as never : {}),
      ...(((d as Record<string, unknown>).pustaka_pendukung) ? { pustakaPendukung: JSON.stringify((d as Record<string, unknown>).pustaka_pendukung) } as never : {}),
    },
  });
  return c.json({ success: true, data: { id: row.id, course_code: row.courseCode, status: row.status }, message: "Draft created" }, 201);
});

app.get("/api/rps/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!r) return c.json({ success: false, message: "Not found" }, 404);
  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  return c.json({ success: true, data: {
    id: r.id, course_name: r.courseName, course_code: r.courseCode, course_cluster: r.courseCluster,
    faculty: (r as unknown as { faculty?: string | null }).faculty ?? null,
    study_program: (r as unknown as { studyProgram?: string | null }).studyProgram ?? null,
    sks_total: r.sksTotal, sks_theory: r.sksTheory, sks_practice: r.sksPractice, semester: r.semester,
    preparation_date: r.preparationDate, lecturers: parse(r.lecturers), cpl: parse(r.cpl), cpmk: parse(r.cpmk), sub_cpmk: parse(r.subCpmk),
    description: (r as unknown as { description?: string | null }).description ?? null,
    bahan_kajian: parse((r as unknown as { bahanKajian?: string | null }).bahanKajian ?? null),
    pustaka_utama: parse((r as unknown as { pustakaUtama?: string | null }).pustakaUtama ?? null),
    pustaka_pendukung: parse((r as unknown as { pustakaPendukung?: string | null }).pustakaPendukung ?? null),
    weekly_plans: parse(r.weeklyPlans), rtm_tasks: r.rtmTasks ? parse(r.rtmTasks) : [], rubrics: r.rubrics ? parse(r.rubrics) : { observation: [], assessment: [] },
    media_methods: parse(r.mediaMethods), ai_provider: r.aiProvider, ai_model: r.aiModel, status: r.status, file_hash: r.fileHash, created_at: r.createdAt, updated_at: r.updatedAt,
  }});
});

app.put("/api/rps/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const r = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!r) return c.json({ success: false, message: "Not found" }, 404);
  const patch: Record<string, unknown> = {};
  if (body.course_name) patch.courseName = body.course_name as string;
  if (body.course_code) patch.courseCode = body.course_code as string;
  if (body.course_cluster !== undefined) patch.courseCluster = body.course_cluster as string;
  if (body.faculty !== undefined) (patch as Record<string, unknown>).faculty = (body.faculty as string) || null;
  if (body.study_program !== undefined) (patch as Record<string, unknown>).studyProgram = (body.study_program as string) || null;
  if (body.sks_total) patch.sksTotal = body.sks_total as number;
  if (body.sks_theory !== undefined) patch.sksTheory = body.sks_theory as number;
  if (body.sks_practice !== undefined) patch.sksPractice = body.sks_practice as number;
  if (body.semester) patch.semester = body.semester as string;
  if (body.preparation_date) patch.preparationDate = new Date(body.preparation_date as string);
  if (body.lecturers) patch.lecturers = JSON.stringify(body.lecturers);
  if (body.description !== undefined) (patch as Record<string, unknown>).description = body.description ? String(body.description) : null;
  if (body.bahan_kajian !== undefined) (patch as Record<string, unknown>).bahanKajian = JSON.stringify(body.bahan_kajian);
  if (body.pustaka_utama !== undefined) (patch as Record<string, unknown>).pustakaUtama = JSON.stringify(body.pustaka_utama);
  if (body.pustaka_pendukung !== undefined) (patch as Record<string, unknown>).pustakaPendukung = JSON.stringify(body.pustaka_pendukung);
  if (body.cpl) patch.cpl = JSON.stringify(body.cpl);
  if (body.cpmk) patch.cpmk = JSON.stringify(body.cpmk);
  if (body.sub_cpmk) patch.subCpmk = JSON.stringify(body.sub_cpmk);
  if (body.weekly_plans) patch.weeklyPlans = JSON.stringify(body.weekly_plans);
  if (body.rtm_tasks) patch.rtmTasks = JSON.stringify(body.rtm_tasks);
  if (body.rubrics) patch.rubrics = JSON.stringify(body.rubrics);
  if (body.media_methods) patch.mediaMethods = JSON.stringify(body.media_methods);
  const updated = await prisma.rpsDraft.update({ where: { id }, data: patch as never });
  const plans = (()=>{ try{ return JSON.parse(updated.weeklyPlans as string);}catch{ return []; }})();
  const weight_total = (plans as {weight:number}[]).reduce((s,p)=>s+(p.weight??0),0);
  return c.json({ success: true, data: { id: updated.id, updated_at: updated.updatedAt, weekly_plans: plans, weight_total }, message: "Draft updated" });
});

/**
 * Isi draft RPS dari bank kurikulum.
 *
 * Sumbernya mata kuliah yang sudah disahkan prodi, sehingga CPL/CPMK/Sub-CPMK
 * di dokumen konsisten dengan kurikulum — bukan hasil karangan AI atau contoh
 * dari prodi lain. Hanya field yang tersedia di bank yang ditimpa; rencana
 * mingguan tidak disentuh karena itu wewenang dosen pengampu.
 */
app.post("/api/rps/:id/apply-course", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as { course_id?: number };
  if (!Number.isInteger(body.course_id)) {
    return c.json({ success: false, error: "validation_error", message: "course_id wajib diisi" }, 422);
  }

  const course = await prisma.course.findUnique({
    where: { id: body.course_id! },
    include: {
      cpmks: { orderBy: { ordering: "asc" }, include: { subCpmks: { orderBy: { ordering: "asc" } } } },
      studyProgram: true,
    },
  });
  if (!course) return c.json({ success: false, message: "Mata kuliah tidak ditemukan di bank kurikulum" }, 404);

  const programCpl = parseJsonArray(course.studyProgram.cpl) as { code?: string; description?: string }[];
  // CPL yang dibebankan pada MK ini saja — bukan seluruh CPL prodi.
  const chargedCodes = new Set(
    course.cpmks.map((x) => (x.cplCode ?? "").toUpperCase()).filter(Boolean),
  );
  const cpl = programCpl
    .filter((x) => chargedCodes.has(String(x.code ?? "").toUpperCase()))
    .map((x) => ({ code: String(x.code), description: String(x.description ?? "") }));

  const cpmk = course.cpmks.map((x) => ({
    code: x.code,
    description: x.description,
    ...(x.taxonomy ? { taxonomy: x.taxonomy } : {}),
    ...(x.cplCode ? { cpl_code: x.cplCode } : {}),
  }));
  const subCpmk = course.cpmks.flatMap((parent) => parent.subCpmks.map((sub) => ({
    code: sub.code,
    description: sub.description,
    ...(sub.taxonomy ? { taxonomy: sub.taxonomy } : {}),
    cpmk_code: parent.code,
  })));

  const updated = await prisma.rpsDraft.update({
    where: { id },
    data: {
      courseName: course.name,
      courseCode: course.code,
      courseCluster: course.cluster ?? course.studyProgram.label,
      faculty: course.studyProgram.facultyLabel,
      studyProgram: course.studyProgram.value,
      sksTheory: course.sksTheory,
      sksPractice: course.sksPractice,
      sksTotal: course.sksTheory + course.sksPractice,
      semester: String(course.semester),
      ...(course.description ? { description: course.description } : {}),
      bahanKajian: course.bahanKajian,
      pustakaUtama: course.pustakaUtama,
      pustakaPendukung: course.pustakaPendukung,
      cpl: JSON.stringify(cpl),
      cpmk: JSON.stringify(cpmk),
      subCpmk: JSON.stringify(subCpmk),
    },
  });

  return c.json({
    success: true,
    data: {
      id: updated.id,
      course_code: updated.courseCode,
      course_name: updated.courseName,
      applied: { cpl: cpl.length, cpmk: cpmk.length, sub_cpmk: subCpmk.length },
    },
    message: `Terisi dari kurikulum ${course.studyProgram.label}: ${cpmk.length} CPMK, ${subCpmk.length} Sub-CPMK.`,
  });
});

app.delete("/api/rps/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!r) return c.json({ success: false, message: "Not found" }, 404);
  await prisma.rpsDraft.delete({ where: { id } });
  return c.json({ success: true, message: "Draft deleted" });
});

// AI adaptor stubs + audit
// Deskripsi MK 3-5 baris — generate otomatis tanpa /rps/:id (dipakai di Buat RPS sebelum draft ada)
app.post("/api/description/generate", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { course_name?: string; course_code?: string; semester?: string; sks_total?: number; provider?: string; model?: string };
  const courseName = String(body.course_name ?? "").trim();
  const courseCode = String(body.course_code ?? "").trim();
  if (!courseName || !courseCode) return c.json({ success: false, message: "course_name & course_code wajib" }, 422);
  const dPrompt = [
    `Kamu penulis Deskripsi Mata Kuliah (bahan kajian singkat) untuk RPS OBE.`,
    `MK: ${courseName} (${courseCode}), Semester ${body.semester ?? "I"}, SKS ${body.sks_total ?? 4}.`,
    `Tulis deskripsi 3-5 baris (60-120 kata) — bahan kajian singkat yang jadi fondasi prompt AI untuk generate CPL/CPMK/Sub-CPMK & 9 baris weekly 16 minggu.`,
    `Contoh nada: "Mata kuliah ini membahas ... mencakup ... berbasis ... sebagai landasan ...".`,
    `Output JSON ketat tanpa markdown: {"description":"..."}`,
  ].join(" ");
  let provider = body.provider as string | undefined;
  if (!provider) {
    const anyKey = await prisma.apiKey.findFirst({ where: { isActive: true } });
    provider = anyKey?.provider;
  }
  if (!provider) return c.json({ success: false, message: "No API key set. Buka /settings." }, 422);
  const keyRow = await prisma.apiKey.findUnique({ where: { provider } });
  if (!keyRow) return c.json({ success: false, message: `No key for ${provider}` }, 422);
  let apiKey: string; try { apiKey = decrypt(keyRow.encryptedKey); } catch { return c.json({ success: false, message: "Decrypt failed" }, 500); }
  const GEMINI_FALLBACKS_D = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview"];
  let model = body.model ?? (provider === "openai" ? "gpt-4o-mini" : provider === "gemini" ? "gemini-3.6-flash" : "claude-3-haiku");
  if (provider === "gemini" && /gemini-(1\.5|2\.5)-/.test(model)) model = "gemini-3.6-flash";
  try {
    let description: string | null = null;
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "system", content: "Output JSON only: {\"description\":\"...\"}" }, { role: "user", content: dPrompt }], response_format: { type: "json_object" }, temperature: 0.5 }),
      });
      if (!r.ok) { const t = await r.text(); return c.json({ success: false, message: `Provider error ${r.status}`, error: t }, 502); }
      const j = await r.json() as { choices: { message: { content: string } }[] };
      const parsed = JSON.parse(j.choices[0].message.content) as { description?: string };
      description = parsed.description?.trim() ?? null;
    } else if (provider === "gemini") {
      let lastErr = ""; let successModel = model;
      const tryModels = [model, ...GEMINI_FALLBACKS_D.filter((m) => m !== model)];
      for (const tryM of tryModels) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(tryM)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: dPrompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.5 } }),
        });
        if (r.ok) {
          try {
            const j = await r.json() as { candidates: { content: { parts: { text: string }[] } }[] };
            const txt = j.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!txt) throw new Error("empty candidates");
            const parsed = JSON.parse(txt) as { description?: string };
            description = parsed.description?.trim() ?? null;
            successModel = tryM; lastErr = ""; break;
          } catch (e) { lastErr = String(e).slice(0, 400); continue; }
        }
        lastErr = await r.text().catch(() => String(r.status));
        if (r.status === 401 || r.status === 403 || r.status === 429) break;
      }
      if (!description) return c.json({ success: false, message: `Provider error`, error: lastErr.slice(0, 1500) }, 502);
      model = successModel;
    } else return c.json({ success: false, message: "Claude belum tersedia untuk deskripsi" }, 502);
    if (!description || description.length < 20) return c.json({ success: false, message: "AI output terlalu pendek" }, 502);
    return c.json({ success: true, data: { description, provider, model }, message: "Description generated" });
  } catch (e) {
    return c.json({ success: false, message: "AI generate failed", error: String(e) }, 502);
  }
});

// Persist + return description untuk existing draft ( dipakai di /rps/:id )
app.post("/api/rps/:id/description/generate", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as { provider?: string; model?: string; course_name?: string; course_code?: string };
  const providerBody = body.provider;
  const courseName = String(body.course_name ?? draft.courseName).trim();
  const courseCode = String(body.course_code ?? draft.courseCode).trim();
  // reuse same logic by internal fetch to /api/description/generate semantics
  const dPrompt = [
    `Kamu penulis Deskripsi Mata Kuliah (bahan kajian singkat) untuk RPS OBE.`,
    `MK: ${courseName} (${courseCode}), Semester ${draft.semester}, SKS ${draft.sksTotal}.`,
    `Tulis deskripsi 3-5 baris (60-120 kata) — bahan kajian singkat yang jadi fondasi prompt AI untuk generate CPL/CPMK/Sub-CPMK & 9 baris weekly 16 minggu.`,
    `Output JSON ketat tanpa markdown: {"description":"..."}`,
  ].join(" ");
  let provider = providerBody as string | undefined;
  if (!provider) {
    const anyKey = await prisma.apiKey.findFirst({ where: { isActive: true } });
    provider = anyKey?.provider;
  }
  if (!provider) return c.json({ success: false, message: "No API key set. Buka /settings." }, 422);
  const keyRow = await prisma.apiKey.findUnique({ where: { provider } });
  if (!keyRow) return c.json({ success: false, message: `No key for ${provider}` }, 422);
  let apiKey: string; try { apiKey = decrypt(keyRow.encryptedKey); } catch { return c.json({ success: false, message: "Decrypt failed" }, 500); }
  const GEMINI_FALLBACKS_D2 = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview"];
  let model = body.model ?? (provider === "openai" ? "gpt-4o-mini" : provider === "gemini" ? "gemini-3.6-flash" : "claude-3-haiku");
  if (provider === "gemini" && /gemini-(1\.5|2\.5)-/.test(model)) model = "gemini-3.6-flash";
  try {
    let description: string | null = null;
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "system", content: "Output JSON only: {\"description\":\"...\"}" }, { role: "user", content: dPrompt }], response_format: { type: "json_object" }, temperature: 0.5 }),
      });
      if (!r.ok) { const t = await r.text(); return c.json({ success: false, message: `Provider error ${r.status}`, error: t }, 502); }
      const j = await r.json() as { choices: { message: { content: string } }[] };
      description = (JSON.parse(j.choices[0].message.content) as { description?: string }).description?.trim() ?? null;
    } else if (provider === "gemini") {
      let lastErr = ""; let successModel = model;
      const tryModels2 = [model, ...GEMINI_FALLBACKS_D2.filter((m) => m !== model)];
      for (const tryM of tryModels2) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(tryM)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: dPrompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.5 } }),
        });
        if (r.ok) {
          try {
            const j = await r.json() as { candidates: { content: { parts: { text: string }[] } }[] };
            const txt = j.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!txt) throw new Error("empty candidates");
            description = (JSON.parse(txt) as { description?: string }).description?.trim() ?? null;
            successModel = tryM; lastErr = ""; break;
          } catch (e) { lastErr = String(e).slice(0, 400); continue; }
        }
        lastErr = await r.text().catch(() => String(r.status));
        if (r.status === 401 || r.status === 403 || r.status === 429) break;
      }
      if (!description) return c.json({ success: false, message: `Provider error`, error: lastErr.slice(0, 1500) }, 502);
      model = successModel;
    } else return c.json({ success: false, message: "Claude belum tersedia untuk deskripsi" }, 502);
    if (!description || description.length < 20) return c.json({ success: false, message: "AI output terlalu pendek" }, 502);
    await prisma.rpsDraft.update({ where: { id }, data: { description } as never });
    return c.json({ success: true, data: { description, provider, model }, message: "Description generated & saved" });
  } catch (e) {
    return c.json({ success: false, message: "AI generate failed", error: String(e) }, 502);
  }
});

app.post("/api/rps/:id/ai/generate", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  const body = await c.req.json().catch(()=>({})) as { provider?: string; model?: string; promptOverride?: string };
  let provider = body.provider as string | undefined;
  if (!provider) {
    const anyKey = await prisma.apiKey.findFirst({ where: { isActive: true } });
    provider = anyKey?.provider;
  }
  if (!provider) return c.json({ success: false, message: "No API key set. Buka /settings." }, 422);
  const keyRow = await prisma.apiKey.findUnique({ where: { provider } });
  if (!keyRow) return c.json({ success: false, message: `No key for ${provider}` }, 422);
   let apiKey: string; try { apiKey = decrypt(keyRow.encryptedKey); } catch { return c.json({ success: false, message: "Decrypt failed" }, 500); }
  const GEMINI_FALLBACKS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-flash-latest"];
  const rawModel = body.model;
  let model = rawModel ?? (provider === "openai" ? "gpt-4o-mini" : provider === "gemini" ? "gemini-3.6-flash" : "claude-3-haiku");
  // auto-upgrade deprecated gemini 1.5/2.5 -> 3.6 (Google 404: no longer available to new users)
  if (provider === "gemini" && /gemini-(1\.5|2\.5)-/.test(model)) {
    model = "gemini-3.6-flash";
  }
  const descriptionForPrompt = (() => { try { return String((draft as unknown as { description?: string | null }).description ?? "").trim(); } catch { return ""; } })();
  // Program context — dipakai agar AI align CPL/CPMK dengan visi/misi/profil prodi dan universitas
  const studyProgramValue = String((draft as unknown as { studyProgram?: string | null }).studyProgram ?? "").trim();
  let programCtx = "";
  let universityCtx = "";
  try {
    if (studyProgramValue) {
      const prog = await prisma.studyProgram.findFirst({ where: { value: studyProgramValue } });
      if (prog) {
        const parseArr = (s: string) => { try { return JSON.parse(s) as string[]; } catch { return []; } };
        const cplArr = (()=>{ try{ return JSON.parse(prog.cpl) as {code:string;description:string}[] } catch{ return [] } })();
        const cplLine = cplArr.length ? `CPL Prodi (SN-Dikti): ${cplArr.map((x)=>`${x.code}: ${x.description}`).join(" | ")}.` : "";
        programCtx = `Prodi: ${prog.label} (${prog.facultyLabel}) — Akreditasi ${prog.akreditasi ?? "-"}. Visi Prodi: ${prog.vision ?? "-"}. Misi: ${(parseArr(prog.mission).slice(0,3).join(" | ")) || "-"}. Profil Lulusan: ${(parseArr(prog.graduateProfile).slice(0,4).join(" | ")) || "-"}. ${cplLine}`;
      }
    }
    const uni = await prisma.universityProfile.findFirst({ orderBy: { id: "asc" } });
    if (uni?.vision) universityCtx = `Visi UNIMERZ: ${uni.vision}.`;
  } catch { /* ignore ctx errors */ }
  // Prompt canonical — 1:1 template 8 kolom (tc1-7) untuk fidelity DOCX + bahan kajian & pustaka
  const prompt = `Kamu generator RPS OBE Universitas Megarezky. Course: ${draft.courseName} (${draft.courseCode}), SKS ${draft.sksTheory}/${draft.sksPractice}, semester ${draft.semester}. ${descriptionForPrompt ? `Deskripsi MK (bahan kajian singkat, R23): ${descriptionForPrompt}` : ""} ${programCtx ? `\nKonteks Prodi (wajib selaras): ${programCtx}` : ""} ${universityCtx ? `\n${universityCtx} Tema: unggul berbasis teknologi.` : ""} 
Instruksi selaras prodi: CPL/CPMK/Sub-CPMK, bahan kajian, pustaka, dan materi weekly WAJIB menurunkan dari Visi/Misi/Profil Lulusan prodi dan CPL SN-Dikti di atas. Untuk prodi kesehatan tekankan asuhan/patient safety/teknologi tepat guna; untuk keguruan tekankan pedagogik & inovasi pembelajaran; untuk bisnis/teknologi tekankan technopreneurship & sistem cerdas; untuk pascasarjana tekankan riset & manajerial. Jangan ubah label fakultas/prodi.
Output JSON ketat tanpa markdown: {"cpl":[{"code":"...","description":"..."}], "cpmk":[{"code":"CPMK 1","description":"...","taxonomy":"C2","cpl_code":"CPL1"}], "sub_cpmk":[{"code":"Sub-CPMK-1","description":"...","taxonomy":"C3","cpmk_code":"CPMK 1"}], "weeklyPlans":[{"week":"1","material":"...","method":"TM 1×(4×50\\")","experience":"Kuliah | Diskusi","assessment_criteria":"Rubrik","sub_cpmk":"Mahasiswa mampu menjelaskan tentang ...","indikator":"Ketepatan dalam menjelaskan ... | Keaktifan dalam diskusi","kriteria":"Rubrik penilaian presentasi kelompok (lampiran 1) | ...","daring":"Menyesuaikan perkembangan pandemic COVID-19","luring":"TM 1×(4×50\\") | Kuliah | Diskusi","materi":"Materi pembelajaran ringkas","weight":5,"is_merged":false}], "bahan_kajian":["Topik1","Topik2",...], "pustaka_utama":["Referensi utama 1","..."], "pustaka_pendukung":["Referensi pendukung 1","..."], "rtmTasks":[{"task_no":1,"description":"Mind Map","duration":"4x50'","weight":5,"cpmk_code":"M1"}], "rubrics":{"observation":[],"assessment":[]}}
Aturan: 9 baris weeklyPlans mewakili 16 minggu: R35 1:5, R36 2:5, R37 3,4:10, R38 5,6,7:20, R39 8:UTS merge is_merged true label UJIAN MID SEMESTER weight 0, R40 9,10,11:30, R41 12,13:10, R42 14,15:20, R43 16:UAS merge is_merged true label UJIAN FINAL SEMESTER weight 0. Sum non-merge 100. 
Setiap weeklyPlans WAJIB isi 8 kolom template 1:1: sub_cpmk (tc1 Sub-CPMK, contoh "Mahasiswa mampu menjelaskan tentang ..."), indikator (tc2 Ketepatan...|Keaktifan...), kriteria (tc3 Kriteria & Bentuk / rubrik), daring (tc4 Daring), luring (tc5 Luring metode + [TM 1x(...) ]), materi (tc6 Materi Pembelajaran), plus week (tc0), weight (tc7). Untuk UTS/UAS hanya week + is_merged true + material label ujian.
Compat: field legacy material/method/experience/assessment_criteria tetap isi; field baru sub_cpmk/indikator/kriteria/daring/luring/materi adalah verbatim untuk DOCX — jangan duplikat antar kolom.
bahan_kajian: 8-20 topik bullet R24 yang selaras MK (mis. Ilkom: Notasi Asimtotik, ADT, Sorting, Graph dst — bukan Biologi). pustaka_utama 2-4 referensi utama terkini + pustaka_pendukung 1-3 — jangan pakai template Ilmu Biomedik bila MK bukan itu.
CPL 2, CPMK 4, Sub-CPMK 7 taxonomy A2/P3/C2/C3/C4, hook Menyesuaikan perkembangan pandemic COVID-19, Daring/Luring split, kop Universitas Megarezky.
${body.promptOverride ?? ""}`;

  type WeeklyGen = { week: string; material: string; method: string; experience: string; assessment_criteria: string; weight: number; is_merged: boolean; sub_cpmk?: string; indikator?: string; kriteria?: string; daring?: string; luring?: string; materi?: string };
  type Gen = { cpl: unknown[]; cpmk: unknown[]; sub_cpmk: unknown[]; weeklyPlans: WeeklyGen[]; rtmTasks: unknown[]; rubrics: unknown; bahan_kajian?: string[]; pustaka_utama?: string[]; pustaka_pendukung?: string[] };
  let gen: Gen | null = null;
  try {
    if (provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "system", content: "You are RPS OBE generator. Output JSON only." }, { role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.4 }),
      });
      if (!r.ok) { const t = await r.text(); return c.json({ success: false, message: `Provider error ${r.status}`, error: t }, 502); }
      const j = await r.json() as { choices: { message: { content: string } }[] };
      gen = JSON.parse(j.choices[0].message.content);
    } else if (provider === "gemini") {
      let lastErr = "";
      let successModel = model;
      const tryModels = [model, ...GEMINI_FALLBACKS.filter((m) => m !== model)];
      for (const tryM of tryModels) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(tryM)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.4 } }),
        });
        if (r.ok) {
          try {
            const j = await r.json() as { candidates: { content: { parts: { text: string }[] } }[] };
            const txt = j.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!txt) throw new Error("empty candidates");
            gen = JSON.parse(txt);
            successModel = tryM;
            lastErr = "";
            break;
          } catch (e) {
            lastErr = `parse failed ${tryM}: ${String(e).slice(0, 400)}`;
            continue;
          }
        }
        lastErr = await r.text().catch(() => String(r.status));
        // retry on 404 (deprecated) and 503 (high demand); fail fast on 401/403/429
        if (r.status === 401 || r.status === 403 || r.status === 429) break;
        // otherwise continue to next fallback
      }
      if (!gen) return c.json({ success: false, message: `Provider error 404/503 — model tidak tersedia. Coba lagi atau pilih model lain.`, error: lastErr.slice(0, 1500) }, 502);
      // remember which model actually succeeded
      model = successModel;
    } else {
      return c.json({ success: false, message: "Claude adaptor belum tersedia" }, 502);
    }
  } catch (e) {
    return c.json({ success: false, message: "AI generate failed", error: String(e) }, 502);
  }
  if (!gen || !Array.isArray(gen.weeklyPlans)) return c.json({ success: false, message: "AI output invalid" }, 502);
  // Zod-ish validate weight
  const sum = gen.weeklyPlans.filter((p) => !p.is_merged).reduce((s, p) => s + p.weight, 0);
  if (sum !== 100) {
    // retry 1x via model? for now return 422 with audit
    const audit = auditDraft({ weeklyPlans: JSON.stringify(gen.weeklyPlans) });
    return c.json({ success: false, message: `Weight sum ${sum} ≠ 100, retry`, audit, data: gen }, 422);
  }
  const audit = auditDraft({ weeklyPlans: JSON.stringify(gen.weeklyPlans) });
  await prisma.rpsDraft.update({ where: { id }, data: {
    cpl: JSON.stringify(gen.cpl ?? []), cpmk: JSON.stringify(gen.cpmk ?? []), subCpmk: JSON.stringify(gen.sub_cpmk ?? []),
    weeklyPlans: JSON.stringify(gen.weeklyPlans), rtmTasks: JSON.stringify(gen.rtmTasks ?? []), rubrics: JSON.stringify(gen.rubrics ?? {}),
    aiProvider: provider, aiModel: model,
    ...(Array.isArray(gen.bahan_kajian) && gen.bahan_kajian.length ? { bahanKajian: JSON.stringify(gen.bahan_kajian) } as never : {}),
    ...(Array.isArray(gen.pustaka_utama) && gen.pustaka_utama.length ? { pustakaUtama: JSON.stringify(gen.pustaka_utama) } as never : {}),
    ...(Array.isArray(gen.pustaka_pendukung) && gen.pustaka_pendukung.length ? { pustakaPendukung: JSON.stringify(gen.pustaka_pendukung) } as never : {}),
  }});
  return c.json({ success: true, data: { ...gen, audit, ai_provider: provider, ai_model: model }, message: "AI generated successfully" });
});

app.post("/api/rps/:id/generate", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  const plans = (()=>{ try{ return JSON.parse(draft.weeklyPlans as string);}catch{ return []; }})();
  const audit = auditDraft({ weeklyPlans: draft.weeklyPlans as string });
  if (!audit.passed) return c.json({ success: false, message: "Audit critical, perbaiki dulu", audit }, 422);
  // Call Python docx service if available, else JS fallback
  const docxUrl = process.env.DOCX_SERVICE_URL ?? "http://localhost:8001";
  // enrich with program vision/misi/profil/CPL for narasi sampul (P33/P38/P48/P57)
  let programVision: string | null = null;
  let programMission: unknown[] = [];
  let programGraduateProfile: unknown[] = [];
  let programCpl: unknown[] = [];
  try {
    const studyVal = String((draft as unknown as { studyProgram?: string | null }).studyProgram ?? "").trim();
    if (studyVal) {
      const prog = await prisma.studyProgram.findFirst({ where: { value: studyVal } });
      if (prog) {
        programVision = prog.vision ?? null;
        try { programMission = JSON.parse(prog.mission); } catch { programMission = []; }
        try { programGraduateProfile = JSON.parse(prog.graduateProfile); } catch { programGraduateProfile = []; }
        try { programCpl = JSON.parse(prog.cpl); } catch { programCpl = []; }
      }
    }
  } catch { /* ignore */ }
  // Dideklarasikan di luar try: blok catch di bawah memakainya untuk fallback JS.
  // Sebelumnya keduanya berada di dalam try sehingga jalur fallback selalu gagal
  // dengan "ReferenceError: faculty is not defined".
  const faculty = (draft as unknown as { faculty?: string | null }).faculty ?? null;
  const studyProgram = (draft as unknown as { studyProgram?: string | null }).studyProgram ?? null;
  try {
    const parseArr = (s: string | null | undefined) => { try { return s ? JSON.parse(s) as unknown[] : []; } catch { return []; } };
    const payload = {
      rps_draft: {
        id: draft.id, course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
        faculty, study_program: studyProgram,
        sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice, semester: draft.semester,
        preparation_date: draft.preparationDate, lecturers: JSON.parse(draft.lecturers as string),
        description: (draft as unknown as { description?: string | null }).description ?? null,
        bahan_kajian: parseArr((draft as unknown as { bahanKajian?: string | null }).bahanKajian ?? null),
        pustaka_utama: parseArr((draft as unknown as { pustakaUtama?: string | null }).pustakaUtama ?? null),
        pustaka_pendukung: parseArr((draft as unknown as { pustakaPendukung?: string | null }).pustakaPendukung ?? null),
        cpl: JSON.parse(draft.cpl as string), cpmk: JSON.parse(draft.cpmk as string), sub_cpmk: JSON.parse(draft.subCpmk as string),
        weekly_plans: plans, rtm_tasks: draft.rtmTasks ? JSON.parse(draft.rtmTasks as string) : [], rubrics: draft.rubrics ? JSON.parse(draft.rubrics as string) : {},
        program_vision: programVision, program_mission: programMission, program_graduate_profile: programGraduateProfile, program_cpl: programCpl,
        kop: [ "Universitas Megarezky", faculty, studyProgram ].filter(Boolean).join(" | "),
      }
    };
    const r = await fetch(`${docxUrl.replace(/\/$/, "")}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const { createHash } = await import("node:crypto");
      const fileHash = createHash("sha256").update(buf).digest("hex");
      const dir = `storage/files/${id}`;
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/${fileHash}.docx`, buf);
      await prisma.rpsDraft.update({ where: { id }, data: { fileHash, storagePath: `${dir}/${fileHash}.docx`, status: "generated" } });
      return c.json({ success: true, data: { docx_url: `/api/rps/${id}/download`, file_hash: fileHash, audit }, message: "DOCX generated successfully" }, 201);
    }
    const errText = await r.text().catch(()=> "");
    throw new Error(`docx service ${r.status}: ${errText.slice(0,200)}`);
  } catch (e) {
    // Fallback: build DOCX via JS (docx lib) so download always works even tanpa Python service
    try {
      const { buildDocxBuffer } = await import("./src/lib/docx.ts");
      const lecturers = (()=>{ try{ return JSON.parse(draft.lecturers as string);}catch{return []}})() as { name:string; role:string; nidn:string }[];
      const buf = await buildDocxBuffer({
        course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
        faculty, study_program: studyProgram,
        sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice,
        semester: draft.semester, preparation_date: String(draft.preparationDate), lecturers, weekly_plans: plans as never,
      });
      const { createHash } = await import("node:crypto");
      const fileHash = createHash("sha256").update(buf).digest("hex");
      const dir = `storage/files/${id}`;
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/${fileHash}.docx`, buf);
      await prisma.rpsDraft.update({ where: { id }, data: { fileHash, storagePath: `${dir}/${fileHash}.docx`, status: "generated" } });
      return c.json({ success: true, data: { docx_url: `/api/rps/${id}/download`, file_hash: fileHash, audit, note: `JS fallback after: ${String(e).slice(0,120)}` }, message: "DOCX generated (JS fallback)" }, 201);
    } catch (e2) {
      const { createHash } = await import("node:crypto");
      const fileHash = createHash("sha256").update(JSON.stringify(plans)).digest("hex").slice(0, 16);
      await prisma.rpsDraft.update({ where: { id }, data: { fileHash, status: "generated" } });
      return c.json({ success: true, data: { docx_url: `/api/rps/${id}/download`, file_hash: fileHash, audit, warning: String(e) + " | fallback: " + String(e2) }, message: "DOCX stub (docx service not running)" }, 201);
    }
  }
});

// Live preview: DOCX ephemeral (tidak tulis storage/file_hash, tidak perlu audit passed) — render di browser via docx-preview
app.post("/api/rps/:id/preview", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as { weekly_plans?: unknown[]; description?: string | null; cpl?: unknown[]; cpmk?: unknown[]; sub_cpmk?: unknown[]; bahan_kajian?: unknown[]; pustaka_utama?: unknown[]; pustaka_pendukung?: unknown[] };
  // Prefer overridden weekly_plans from request (live edit before Save); fall back to stored
  let plans: unknown[];
  if (Array.isArray(body.weekly_plans) && body.weekly_plans.length) {
    plans = body.weekly_plans;
  } else {
    try { plans = JSON.parse(draft.weeklyPlans as string); } catch { plans = []; }
  }
  // Allow ephemeral description/bahan/pustaka/CP overrides (live typing before Simpan)
  const effectiveDescription = typeof body.description === "string" ? body.description : ((draft as unknown as { description?: string | null }).description ?? null);
  const parseDraftArr = (s: string | null | undefined) => { try { return s ? JSON.parse(s) as unknown[] : []; } catch { return []; } };
  const lecturers = (()=>{ try{ return JSON.parse(draft.lecturers as string);}catch{return []}})() as { name:string; role:string; nidn:string }[];
  const cpl = Array.isArray(body.cpl) ? body.cpl : (()=>{ try{ return JSON.parse(draft.cpl as string);}catch{return []}})();
  const cpmk = Array.isArray(body.cpmk) ? body.cpmk : (()=>{ try{ return JSON.parse(draft.cpmk as string);}catch{return []}})();
  const subCpmk = Array.isArray(body.sub_cpmk) ? body.sub_cpmk : (()=>{ try{ return JSON.parse(draft.subCpmk as string);}catch{return []}})();
  const bahanKajian = Array.isArray(body.bahan_kajian) ? body.bahan_kajian : parseDraftArr((draft as unknown as { bahanKajian?: string | null }).bahanKajian ?? null);
  const pustakaUtama = Array.isArray(body.pustaka_utama) ? body.pustaka_utama : parseDraftArr((draft as unknown as { pustakaUtama?: string | null }).pustakaUtama ?? null);
  const pustakaPendukung = Array.isArray(body.pustaka_pendukung) ? body.pustaka_pendukung : parseDraftArr((draft as unknown as { pustakaPendukung?: string | null }).pustakaPendukung ?? null);
  const previewFaculty = (body as Record<string, unknown>).faculty as string | undefined ?? (draft as unknown as { faculty?: string | null }).faculty ?? null;
  const previewProdi = (body as Record<string, unknown>).study_program as string | undefined ?? (draft as unknown as { studyProgram?: string | null }).studyProgram ?? null;
  // enrich preview with program narasi (Visi/Misi/Profil/CPL) depending on previewProdi
  let prevProgramVision: string | null = null;
  let prevProgramMission: unknown[] = [];
  let prevProgramProfile: unknown[] = [];
  let prevProgramCpl: unknown[] = [];
  try {
    const pval = String(previewProdi ?? "").trim();
    if (pval) {
      const prog = await prisma.studyProgram.findFirst({ where: { value: pval } });
      if (prog) {
        prevProgramVision = prog.vision ?? null;
        try { prevProgramMission = JSON.parse(prog.mission); } catch { prevProgramMission = []; }
        try { prevProgramProfile = JSON.parse(prog.graduateProfile); } catch { prevProgramProfile = []; }
        try { prevProgramCpl = JSON.parse(prog.cpl); } catch { prevProgramCpl = []; }
      }
    }
  } catch { /* ignore */ }
  const docxUrl = process.env.DOCX_SERVICE_URL ?? "http://localhost:8001";
  // Python template 100% fidelity
  try {
    const payload = {
      rps_draft: {
        id: draft.id, course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
        faculty: previewFaculty, study_program: previewProdi,
        sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice, semester: draft.semester,
        preparation_date: draft.preparationDate, lecturers, cpl, cpmk, sub_cpmk: subCpmk,
        description: effectiveDescription,
        bahan_kajian: bahanKajian, pustaka_utama: pustakaUtama, pustaka_pendukung: pustakaPendukung,
        weekly_plans: plans, rtm_tasks: draft.rtmTasks ? JSON.parse(draft.rtmTasks as string) : [], rubrics: draft.rubrics ? JSON.parse(draft.rubrics as string) : {},
        program_vision: prevProgramVision, program_mission: prevProgramMission, program_graduate_profile: prevProgramProfile, program_cpl: prevProgramCpl,
        kop: [ "Universitas Megarezky", previewFaculty, previewProdi ].filter(Boolean).join(" | "),
      }
    };
    const r = await fetch(`${docxUrl.replace(/\/$/, "")}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      c.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      c.header("Cache-Control", "no-store");
      return c.body(buf as never);
    }
    throw new Error(`${r.status}`);
  } catch {
    // JS fallback ephemeral
    const { buildDocxBuffer } = await import("./src/lib/docx.ts");
    const buf = await buildDocxBuffer({
      course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
      faculty: previewFaculty, study_program: previewProdi,
      sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice,
      semester: draft.semester, preparation_date: String(draft.preparationDate), lecturers, weekly_plans: plans as never,
    });
    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    c.header("Cache-Control", "no-store");
    c.header("X-Preview-Fallback", "js");
    return c.body(buf as never);
  }
});

app.get("/api/rps/:id/download", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  // If status generated but storagePath not yet set (old stub rows), rebuild via JS fallback on-the-fly
  if (!draft.storagePath) {
    if (draft.status !== "generated") return c.json({ success: false, message: "Belum generate DOCX" }, 404);
    // on-the-fly rebuild so download always works
    try {
      const { buildDocxBuffer } = await import("./src/lib/docx.ts");
      const plans = (()=>{ try{ return JSON.parse(draft.weeklyPlans as string);}catch{return []}})() as never;
      const lecturers = (()=>{ try{ return JSON.parse(draft.lecturers as string);}catch{return []}})() as { name:string; role:string; nidn:string }[];
      const buf = await buildDocxBuffer({
        course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
        sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice,
        semester: draft.semester, preparation_date: String(draft.preparationDate), lecturers, weekly_plans: plans,
      });
      c.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      c.header("Content-Disposition", `attachment; filename="${draft.courseCode}-${draft.courseName}-RPS.docx"`);
      return c.body(buf as never);
    } catch {
      return c.json({ success: false, message: "Belum generate DOCX (storagePath kosong dan fallback gagal)" }, 404);
    }
  }
  try {
    const file = Bun.file(draft.storagePath);
    if (!(await file.exists())) {
      // storagePath points to missing file (e.g. after reset) — fallback rebuild instead of 410 so UX tetap download
      try {
        const { buildDocxBuffer } = await import("./src/lib/docx.ts");
        const plans = (()=>{ try{ return JSON.parse(draft.weeklyPlans as string);}catch{return []}})() as never;
        const lecturers = (()=>{ try{ return JSON.parse(draft.lecturers as string);}catch{return []}})() as { name:string; role:string; nidn:string }[];
        const buf = await buildDocxBuffer({
          course_name: draft.courseName, course_code: draft.courseCode, course_cluster: draft.courseCluster,
          sks_total: draft.sksTotal, sks_theory: draft.sksTheory, sks_practice: draft.sksPractice,
          semester: draft.semester, preparation_date: String(draft.preparationDate), lecturers, weekly_plans: plans,
        });
        c.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        c.header("Content-Disposition", `attachment; filename="${draft.courseCode}-${draft.courseName}-RPS.docx"`);
        return c.body(buf as never);
      } catch {
        return c.json({ success: false, message: "File hilang, generate ulang" }, 410);
      }
    }
    const buf = await file.arrayBuffer();
    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    c.header("Content-Disposition", `attachment; filename="${draft.courseCode}-${draft.courseName}-RPS.docx"`);
    return c.body(buf as never);
  } catch {
    return c.json({ success: false, message: "File hilang" }, 410);
  }
});

app.post("/api/rps/:id/audit", async (c) => {
  const id = Number(c.req.param("id"));
  const draft = await prisma.rpsDraft.findUnique({ where: { id } });
  if (!draft) return c.json({ success: false, message: "Not found" }, 404);
  const result = auditDraft({ weeklyPlans: draft.weeklyPlans as string });
  return c.json({ success: true, data: result });
});

// Catalog: University + StudyProgram (dibangun dari WayBack unimerz.ac.id — 37 prodi, 25 verified + 12 synthetic SN-Dikti)
app.get("/api/university-profile", async (c) => {
  const row = await prisma.universityProfile.findFirst({ orderBy: { id: "asc" } });
  if (!row) return c.json({ success: false, message: "University profile not seeded" }, 404);
  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  return c.json({ success: true, data: {
    id: row.id, vision: row.vision, mission: parse(row.mission), tujuan: parse(row.tujuan),
    sejarah: row.sejarah, source_url: row.sourceUrl, source_timestamp: row.sourceTimestamp, verified_at: row.verifiedAt,
  }});
});

app.get("/api/programs", async (c) => {
  const facultySlug = c.req.query("facultySlug") ?? c.req.query("faculty_slug") ?? "";
  const q = c.req.query("q") ?? "";
  const completeness = c.req.query("completeness") ?? "";
  const where: Record<string, unknown> = {};
  if (facultySlug) (where as Record<string,string>).facultySlug = facultySlug;
  if (completeness) (where as Record<string,string>).completeness = completeness;
  if (q) (where as Record<string, unknown>).OR = [{ label: { contains: q } }, { value: { contains: q } }, { slug: { contains: q } }];
  const rows = await prisma.studyProgram.findMany({ where: where as never, orderBy: [{ facultySlug: "asc" }, { label: "asc" }] });
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return []; } };
  const parseCpl = (s: string) => { try { return JSON.parse(s); } catch { return []; } };
  return c.json({ success: true, data: rows.map((r) => ({
    slug: r.slug, faculty_label: r.facultyLabel, faculty_slug: r.facultySlug, label: r.label, value: r.value,
    akreditasi: r.akreditasi, href: r.href, vision: r.vision, mission: parse(r.mission), objective: parse(r.objective),
    graduate_profile: parse(r.graduateProfile), cpl: parseCpl(r.cpl), source_url: r.sourceUrl, source_timestamp: r.sourceTimestamp, completeness: r.completeness,
  }))});
});

app.get("/api/programs/:slug", async (c) => {
  const slug = c.req.param("slug");
  const r = await prisma.studyProgram.findUnique({ where: { slug } });
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return []; } };
  const parseCpl = (s: string) => { try { return JSON.parse(s); } catch { return []; } };
  const toData = (row: typeof r & { cpl: string }) => ({
    slug: row!.slug, faculty_label: row!.facultyLabel, faculty_slug: row!.facultySlug, label: row!.label, value: row!.value,
    akreditasi: row!.akreditasi, href: row!.href, vision: row!.vision, mission: parse(row!.mission), objective: parse(row!.objective),
    graduate_profile: parse(row!.graduateProfile), cpl: parseCpl(row!.cpl), source_url: row!.sourceUrl, source_timestamp: row!.sourceTimestamp, completeness: row!.completeness,
  });
  if (!r) {
    const byValue = await prisma.studyProgram.findFirst({ where: { value: slug } });
    if (!byValue) return c.json({ success: false, message: "Program not found" }, 404);
    return c.json({ success: true, data: toData(byValue as unknown as typeof r & { cpl: string }) });
  }
  return c.json({ success: true, data: toData(r as unknown as typeof r & { cpl: string }) });
});

// Diekspor agar `server.test.ts` bisa memanggil route lewat `app.request()`
// tanpa membuka port.
export { app };

export default {
  port: Number(process.env.PORT ?? 3001),
  fetch: app.fetch,
};
