import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "./db";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Auth untuk panel admin master data OBE.
 *
 * Password di-hash satu arah dengan scrypt (`node:crypto`). Sengaja TIDAK
 * memakai `src/lib/crypto.ts`: fungsi di sana AES-256-GCM yang reversible —
 * benar untuk API key BYOK (harus bisa didekripsi untuk memanggil provider),
 * tapi salah untuk password, yang tidak boleh bisa dibaca kembali bahkan oleh
 * pemilik server.
 *
 * Sesi berupa token acak yang dicatat di tabel `admin_session`, bukan JWT:
 * panel admin perlu bisa mencabut akses (logout, akun dinonaktifkan) sebelum
 * masa berlaku habis, dan token stateless tidak bisa dicabut.
 */

export const SESSION_COOKIE = "rps_admin_session";
export const SESSION_TTL_HOURS = 8;

/** Percobaan gagal sebelum akun terkunci sementara. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Faktor kerja scrypt. N=2^16 memenuhi anjuran OWASP (minimum 2^16, r=8, p=1)
 * dan terukur ~156 ms di mesin pengembangan — cukup lambat untuk menghambat
 * penebakan massal, cukup cepat untuk login interaktif.
 */
const SCRYPT_N = 1 << 16;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

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

/** NIDN PDDikti: tepat 10 digit angka. */
export function isValidNidn(value: string): boolean {
  return /^\d{10}$/.test(value.trim());
}

/** Format tersimpan: `scrypt$N$r$p$salt$hash`, salt & hash base64. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const [tag, n, r, p, saltB64, hashB64] = stored.split("$");
    if (tag !== "scrypt" || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, "base64");
    const derived = await scrypt(plain, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    // Hash rusak/format asing — perlakukan sebagai gagal, jangan biarkan
    // exception-nya membocorkan apa pun ke pemanggil.
    return false;
  }
}

/**
 * Kerjakan hashing sia-sia untuk NIDN yang tidak terdaftar. Tanpa ini, respons
 * untuk NIDN tidak dikenal kembali jauh lebih cepat daripada NIDN yang ada,
 * sehingga penyerang bisa memetakan akun mana yang valid dari selisih waktu.
 */
export async function burnPasswordTiming(plain: string): Promise<void> {
  await hashPassword(plain);
}

export function passwordIssues(plain: string): string[] {
  const issues: string[] = [];
  if (plain.length < MIN_PASSWORD_LENGTH) issues.push(`Minimal ${MIN_PASSWORD_LENGTH} karakter`);
  if (!/[a-z]/.test(plain)) issues.push("Harus ada huruf kecil");
  if (!/[A-Z]/.test(plain)) issues.push("Harus ada huruf besar");
  if (!/\d/.test(plain)) issues.push("Harus ada angka");
  return issues;
}

function newSessionId(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(
  userId: number,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ id: string; expiresAt: Date }> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  await prisma.adminSession.create({
    data: { id, userId, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
  });
  return { id, expiresAt };
}

export async function destroySession(id: string): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { id } });
}

export async function destroyAllSessions(userId: number): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { userId } });
}

/**
 * Tukar token sesi jadi identitas. Mengembalikan `null` untuk sesi tidak ada,
 * kedaluwarsa, atau milik akun yang sudah dinonaktifkan — pemeriksaan
 * `isActive` di sini yang membuat pencabutan akses berlaku seketika.
 */
export async function resolveSession(token: string | undefined): Promise<AdminIdentity | null> {
  if (!token) return null;
  const session = await prisma.adminSession.findUnique({
    where: { id: token },
    include: { user: { include: { faculty: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await destroySession(session.id);
    return null;
  }
  const user = session.user;
  if (!user.isActive) return null;
  return {
    id: user.id,
    nidn: user.nidn,
    name: user.name,
    role: user.role as AdminRole,
    facultyId: user.facultyId,
    facultyLabel: user.faculty?.label ?? null,
    facultySlug: user.faculty?.slug ?? null,
    mustChangePassword: user.mustChangePassword,
  };
}

/** Hapus sesi kedaluwarsa. Dipanggil oportunistik saat login. */
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}

export type LoginFailure =
  | { kind: "invalid_credentials" }
  | { kind: "locked"; retryAfterSeconds: number }
  | { kind: "inactive" };

export type LoginResult =
  | { ok: true; identity: AdminIdentity; session: { id: string; expiresAt: Date } }
  | { ok: false; failure: LoginFailure };

/**
 * Verifikasi kredensial lalu terbitkan sesi.
 *
 * Semua kegagalan kredensial mengembalikan bentuk yang sama
 * (`invalid_credentials`) supaya pemanggil tidak bisa membedakan "NIDN tidak
 * terdaftar" dari "password salah" — pembedaan itu memberi penyerang daftar
 * NIDN yang valid secara gratis.
 */
export async function login(
  nidnRaw: string,
  password: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<LoginResult> {
  const nidn = nidnRaw.trim();
  const user = await prisma.adminUser.findUnique({ where: { nidn } });

  if (!user) {
    await burnPasswordTiming(password);
    return { ok: false, failure: { kind: "invalid_credentials" } };
  }
  if (!user.isActive) {
    await burnPasswordTiming(password);
    return { ok: false, failure: { kind: "inactive" } };
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return {
      ok: false,
      failure: {
        kind: "locked",
        retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
      },
    };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failedAttempts = user.failedAttempts + 1;
    const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS;
    await prisma.adminUser.update({
      where: { id: user.id },
      data: {
        failedAttempts: shouldLock ? 0 : failedAttempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
      },
    });
    if (shouldLock) {
      return { ok: false, failure: { kind: "locked", retryAfterSeconds: LOCKOUT_MINUTES * 60 } };
    }
    return { ok: false, failure: { kind: "invalid_credentials" } };
  }

  await prisma.adminUser.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await pruneExpiredSessions();
  const session = await createSession(user.id, meta);
  const withFaculty = await prisma.adminUser.findUnique({
    where: { id: user.id },
    include: { faculty: true },
  });
  return {
    ok: true,
    session,
    identity: {
      id: user.id,
      nidn: user.nidn,
      name: user.name,
      role: user.role as AdminRole,
      facultyId: user.facultyId,
      facultyLabel: withFaculty?.faculty?.label ?? null,
      facultySlug: withFaculty?.faculty?.slug ?? null,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

/**
 * Apakah admin ini berwenang atas fakultas tertentu.
 * Perbandingan memakai `facultyId`, bukan label — kecocokan berbasis string
 * rapuh terhadap selisih spasi/kapitalisasi, dan di jalur otorisasi kerapuhan
 * itu berarti akses yang jebol.
 */
export function canManageFaculty(identity: AdminIdentity, facultyId: number | null): boolean {
  if (identity.role === "super_admin") return true;
  if (identity.facultyId === null || facultyId === null) return false;
  return identity.facultyId === facultyId;
}

export async function changePassword(userId: number, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await prisma.adminUser.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false, failedAttempts: 0, lockedUntil: null },
  });
  // Paksa login ulang di semua perangkat: setelah password berganti, sesi lama
  // yang mungkin sudah dikuasai orang lain harus mati.
  await destroyAllSessions(userId);
}
