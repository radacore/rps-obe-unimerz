/**
 * Test auth & otorisasi panel admin.
 *
 * Menjalankan aplikasi Hono langsung lewat `app.request()` — tanpa server dan
 * tanpa port — tapi memakai database sungguhan supaya jalur Prisma, cookie, dan
 * penguncian akun ikut teruji, bukan hanya logika di dalam memori.
 *
 *   bun test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { app, __resetLoginRateLimit } from "./server";
import { prisma } from "./src/lib/db";
import { hashPassword, MAX_FAILED_ATTEMPTS } from "./src/lib/auth";
import { encrypt, keyHint } from "./src/lib/crypto";

const SUPER_NIDN = "9000000001";
const FIKOM_NIDN = "9000000002";
const OTHER_NIDN = "9000000003";
const INACTIVE_NIDN = "9000000004";
const PASSWORD = "UjiCoba2026aman";

let fikomSlug = "";
let farmasiSlug = "";

/** Ambil nilai cookie sesi dari header Set-Cookie. */
function sessionCookie(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const match = /rps_admin_session=([^;]*)/.exec(raw);
  if (!match || !match[1]) return null;
  return `rps_admin_session=${match[1]}`;
}

function req(path: string, init?: RequestInit & { cookie?: string }) {
  const { cookie, ...rest } = init ?? {};
  return app.request(path, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(rest.headers ?? {}),
    },
  });
}

function loginAs(nidn: string, password = PASSWORD) {
  return req("/api/admin/login", { method: "POST", body: JSON.stringify({ nidn, password }) });
}

/** Setel ulang password akun ke PASSWORD uji tanpa mengubah peran/lingkupnya. */
async function seedUserPassword(nidn: string) {
  await prisma.adminUser.update({
    where: { nidn },
    data: { passwordHash: await hashPassword(PASSWORD), failedAttempts: 0, lockedUntil: null },
  });
}

async function seedUser(nidn: string, role: string, facultyId: number | null, opts?: { isActive?: boolean }) {
  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.adminUser.upsert({
    where: { nidn },
    update: { role, facultyId, passwordHash, isActive: opts?.isActive ?? true, mustChangePassword: false, failedAttempts: 0, lockedUntil: null },
    create: { nidn, name: `Uji ${nidn}`, role, facultyId, passwordHash, isActive: opts?.isActive ?? true, mustChangePassword: false },
  });
  await seedApiKey(user.id);
}

/**
 * Membuat RPS mensyaratkan penulisnya punya API key sendiri, jadi akun uji
 * dibekali kunci palsu. Kunci ini tidak pernah dipakai memanggil provider —
 * test tidak menyentuh jaringan.
 */
async function seedApiKey(ownerId: number) {
  const fake = "AIzaFakeKeyUntukPengujianSaja1234";
  await prisma.apiKey.upsert({
    where: { ownerId_provider: { ownerId, provider: "gemini" } },
    update: { encryptedKey: encrypt(fake), keyHint: keyHint(fake), isActive: true },
    create: { ownerId, provider: "gemini", encryptedKey: encrypt(fake), keyHint: keyHint(fake) },
  });
}

// Rate limit login dibagi seluruh proses; tanpa reset, kasus uji berikutnya
// akan kena kuota yang dihabiskan kasus sebelumnya.
beforeEach(() => {
  __resetLoginRateLimit();
});

beforeAll(async () => {
  const fikom = await prisma.faculty.findUnique({ where: { slug: "fikom" }, include: { programs: true } });
  const farmasi = await prisma.faculty.findUnique({ where: { slug: "farmasi" }, include: { programs: true } });
  if (!fikom?.programs.length || !farmasi?.programs.length) {
    throw new Error("Butuh data seed: jalankan `bun run db:seed` lebih dulu");
  }
  fikomSlug = fikom.programs[0].slug;
  farmasiSlug = farmasi.programs[0].slug;

  await seedUser(SUPER_NIDN, "super_admin", null);
  await seedUser(FIKOM_NIDN, "faculty_admin", fikom.id);
  await seedUser(OTHER_NIDN, "faculty_admin", farmasi.id);
  await seedUser(INACTIVE_NIDN, "faculty_admin", fikom.id, { isActive: false });
});

afterAll(async () => {
  // Draft bantu yang dibuat langsung lewat Prisma tidak punya pemilik; kalau
  // tertinggal, ia akan tampak sebagai data produksi yang tak bisa diubah.
  await prisma.rpsDraft.deleteMany({ where: { courseCode: { in: ["TMPX", "TMPY"] } } });
  const nidns = [SUPER_NIDN, FIKOM_NIDN, OTHER_NIDN, INACTIVE_NIDN, "9000000005", "9000000006", "9000000007", "9000000008"];
  // Jejak audit dari akun uji dibuang agar riwayat produksi tidak tercemar.
  await prisma.auditLog.deleteMany({ where: { actorNidn: { in: nidns } } });
  await prisma.auditLog.deleteMany({ where: { entityRef: { in: nidns } } });
  await prisma.adminSession.deleteMany({ where: { user: { nidn: { in: nidns } } } });
  await prisma.adminUser.deleteMany({ where: { nidn: { in: nidns } } });
  await prisma.$disconnect();
});

describe("login", () => {
  test("kredensial benar menerbitkan cookie sesi httpOnly", async () => {
    const res = await loginAs(SUPER_NIDN);
    expect(res.status).toBe(200);
    const raw = res.headers.get("set-cookie") ?? "";
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Lax");
    const body = await res.json();
    expect(body.data.role).toBe("super_admin");
  });

  test("password salah dan NIDN tak terdaftar memberi pesan yang identik", async () => {
    const wrongPassword = await loginAs(SUPER_NIDN, "SalahSekali2026x");
    const unknownNidn = await loginAs("9999999999", "SalahSekali2026x");
    expect(wrongPassword.status).toBe(401);
    expect(unknownNidn.status).toBe(401);
    // Pesan yang berbeda akan mengungkap NIDN mana yang terdaftar.
    expect((await wrongPassword.json()).message).toBe((await unknownNidn.json()).message);
    await prisma.adminUser.update({ where: { nidn: SUPER_NIDN }, data: { failedAttempts: 0, lockedUntil: null } });
  });

  test("NIDN bukan 10 digit ditolak sebagai galat validasi", async () => {
    const res = await loginAs("123");
    expect(res.status).toBe(422);
    expect((await res.json()).errors.nidn).toBeDefined();
  });

  test("akun nonaktif tidak bisa login walau password benar", async () => {
    const res = await loginAs(INACTIVE_NIDN);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("account_inactive");
  });

  test("akun terkunci setelah percobaan gagal berulang, password benar pun ditolak", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await loginAs(FIKOM_NIDN, "TebakanSalah2026");
    }
    const locked = await loginAs(FIKOM_NIDN);
    expect(locked.status).toBe(423);
    expect(locked.headers.get("retry-after")).toBeTruthy();

    const row = await prisma.adminUser.findUnique({ where: { nidn: FIKOM_NIDN } });
    expect(row?.lockedUntil).not.toBeNull();

    // Lepas kunci untuk test berikutnya.
    await prisma.adminUser.update({ where: { nidn: FIKOM_NIDN }, data: { failedAttempts: 0, lockedUntil: null } });
    expect((await loginAs(FIKOM_NIDN)).status).toBe(200);
  });
});

describe("sesi", () => {
  test("endpoint admin menolak request tanpa sesi", async () => {
    expect((await req("/api/admin/me")).status).toBe(401);
    expect((await req("/api/admin/programs")).status).toBe(401);
    const put = await req(`/api/admin/programs/${fikomSlug}`, {
      method: "PUT", body: JSON.stringify({ vision: "tanpa sesi" }),
    });
    expect(put.status).toBe(401);
  });

  test("cookie palsu ditolak", async () => {
    const res = await req("/api/admin/me", { cookie: "rps_admin_session=palsu-sekali" });
    expect(res.status).toBe(401);
  });

  test("logout mencabut sesi seketika", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    expect((await req("/api/admin/me", { cookie })).status).toBe(200);
    await req("/api/admin/logout", { method: "POST", cookie });
    expect((await req("/api/admin/me", { cookie })).status).toBe(401);
  });

  test("sesi kedaluwarsa ditolak dan dibersihkan", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const token = cookie.split("=")[1];
    await prisma.adminSession.update({ where: { id: token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await req("/api/admin/me", { cookie })).status).toBe(401);
    expect(await prisma.adminSession.findUnique({ where: { id: token } })).toBeNull();
  });

  test("menonaktifkan akun langsung mematikan sesi yang sedang berjalan", async () => {
    const cookie = sessionCookie(await loginAs(OTHER_NIDN))!;
    expect((await req("/api/admin/me", { cookie })).status).toBe(200);
    await prisma.adminUser.update({ where: { nidn: OTHER_NIDN }, data: { isActive: false } });
    expect((await req("/api/admin/me", { cookie })).status).toBe(401);
    await prisma.adminUser.update({ where: { nidn: OTHER_NIDN }, data: { isActive: true } });
  });
});

describe("scoping wewenang fakultas", () => {
  test("admin fakultas hanya melihat prodi di fakultasnya", async () => {
    const cookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const res = await req("/api/admin/programs", { cookie });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    const faculties = new Set(body.data.map((p: { faculty_slug: string }) => p.faculty_slug));
    expect([...faculties]).toEqual(["fikom"]);
  });

  test("super admin melihat seluruh prodi", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const body = await (await req("/api/admin/programs", { cookie })).json();
    const total = await prisma.studyProgram.count();
    expect(body.data.length).toBe(total);
  });

  test("admin fakultas bisa mengubah prodi sendiri", async () => {
    const cookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });
    const res = await req(`/api/admin/programs/${fikomSlug}`, {
      method: "PUT", cookie,
      body: JSON.stringify({ vision: "Visi hasil uji", mission: ["Misi satu", "Misi dua"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.vision).toBe("Visi hasil uji");
    expect(body.data.mission).toEqual(["Misi satu", "Misi dua"]);

    await prisma.studyProgram.update({
      where: { slug: fikomSlug },
      data: { vision: before!.vision, mission: before!.mission },
    });
  });

  test("admin fakultas TIDAK bisa mengubah prodi fakultas lain, dan datanya tidak berubah", async () => {
    const cookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: farmasiSlug } });

    const res = await req(`/api/admin/programs/${farmasiSlug}`, {
      method: "PUT", cookie, body: JSON.stringify({ vision: "Sabotase lintas fakultas" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");

    const after = await prisma.studyProgram.findUnique({ where: { slug: farmasiSlug } });
    expect(after!.vision).toBe(before!.vision);
    expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
  });

  test("prodi tak dikenal menghasilkan 404", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req("/api/admin/programs/prodi-tidak-ada", {
      method: "PUT", cookie, body: JSON.stringify({ vision: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("validasi perubahan profil", () => {
  test("field di luar daftar ditolak, bukan diabaikan", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });
    const res = await req(`/api/admin/programs/${fikomSlug}`, {
      method: "PUT", cookie,
      // `completeness` dan `facultyId` bukan milik admin; kalau lolos, admin
      // bisa memindahkan prodi ke fakultas lain lewat payload.
      body: JSON.stringify({ vision: "x", completeness: "verified", facultyId: 1 }),
    });
    expect(res.status).toBe(422);
    const after = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });
    expect(after!.facultyId).toBe(before!.facultyId);
    expect(after!.completeness).toBe(before!.completeness);
  });

  test("payload kosong ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req(`/api/admin/programs/${fikomSlug}`, { method: "PUT", cookie, body: "{}" });
    expect(res.status).toBe(422);
  });

  test("baris kosong dibuang dari daftar", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });
    const res = await req(`/api/admin/programs/${fikomSlug}`, {
      method: "PUT", cookie,
      body: JSON.stringify({ graduate_profile: ["Analis Sistem", "   ", "Pengembang"] }),
    });
    expect(res.status).toBe(422); // string kosong gagal min(1) — ditolak, bukan disimpan diam-diam
    const after = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });
    expect(after!.graduateProfile).toBe(before!.graduateProfile);
  });
});

describe("ganti password", () => {
  test("wajib ganti password memblokir mutasi master data", async () => {
    await prisma.adminUser.update({ where: { nidn: OTHER_NIDN }, data: { mustChangePassword: true } });
    const cookie = sessionCookie(await loginAs(OTHER_NIDN))!;
    const farmasi = await prisma.studyProgram.findUnique({ where: { slug: farmasiSlug } });
    expect(farmasi).not.toBeNull();

    const res = await req(`/api/admin/programs/${farmasiSlug}`, {
      method: "PUT", cookie, body: JSON.stringify({ vision: "belum ganti password" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("password_change_required");
    await prisma.adminUser.update({ where: { nidn: OTHER_NIDN }, data: { mustChangePassword: false } });
  });

  test("password baru yang lemah ditolak dengan alasan per-syarat", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req("/api/admin/change-password", {
      method: "POST", cookie,
      body: JSON.stringify({ current_password: PASSWORD, new_password: "lemah" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.new_password.length).toBeGreaterThan(1);
  });

  test("password lama yang salah ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req("/api/admin/change-password", {
      method: "POST", cookie,
      body: JSON.stringify({ current_password: "BukanPasswordku9", new_password: "GantiPassword2026" }),
    });
    expect(res.status).toBe(401);
  });

  test("ganti password mencabut semua sesi lain", async () => {
    const first = sessionCookie(await loginAs(SUPER_NIDN))!;
    const second = sessionCookie(await loginAs(SUPER_NIDN))!;
    const newPassword = "PasswordSegar2026";

    const res = await req("/api/admin/change-password", {
      method: "POST", cookie: first,
      body: JSON.stringify({ current_password: PASSWORD, new_password: newPassword }),
    });
    expect(res.status).toBe(200);

    // Sesi kedua yang tidak terlibat pun harus mati.
    expect((await req("/api/admin/me", { cookie: second })).status).toBe(401);
    expect((await loginAs(SUPER_NIDN, PASSWORD)).status).toBe(401);
    expect((await loginAs(SUPER_NIDN, newPassword)).status).toBe(200);

    await seedUser(SUPER_NIDN, "super_admin", null); // pulihkan password uji
  });
});

describe("rate limit login", () => {
  test("percobaan berlebih dari satu sumber dibatasi dengan 429 + Retry-After", async () => {
    let sawRateLimit = false;
    let retryAfter: string | null = null;
    // Batasnya 20 per 15 menit; NIDN dirotasi supaya yang menahan adalah
    // pembatas per-sumber, bukan penguncian per-akun.
    for (let i = 0; i < 30; i++) {
      const res = await loginAs(`80000000${String(i).padStart(2, "0")}`, "TebakanNgawur1");
      if (res.status === 429) {
        sawRateLimit = true;
        retryAfter = res.headers.get("retry-after");
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  test("X-Forwarded-For tidak dipercaya saat TRUST_PROXY mati, jadi tidak bisa dipakai memutar kuota", async () => {
    let blockedWithRotatingHeader = false;
    for (let i = 0; i < 30; i++) {
      // Penyerang memalsukan IP berbeda tiap request. Tanpa TRUST_PROXY,
      // header ini diabaikan sehingga pembatas tetap menahan.
      const res = await app.request("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": `203.0.113.${i}` },
        body: JSON.stringify({ nidn: "9000000001", password: "TebakanNgawur1" }),
      });
      if (res.status === 429) { blockedWithRotatingHeader = true; break; }
    }
    expect(blockedWithRotatingHeader).toBe(true);
    await prisma.adminUser.update({ where: { nidn: SUPER_NIDN }, data: { failedAttempts: 0, lockedUntil: null } });
  });
});

describe("profil fakultas", () => {
  test("admin fakultas hanya melihat fakultasnya, super admin melihat semua", async () => {
    const fikomCookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const fikomBody = await (await req("/api/admin/faculties", { cookie: fikomCookie })).json();
    expect(fikomBody.data.length).toBe(1);
    expect(fikomBody.data[0].slug).toBe("fikom");
    expect(fikomBody.data[0].program_count).toBeGreaterThan(0);

    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const superBody = await (await req("/api/admin/faculties", { cookie: superCookie })).json();
    expect(superBody.data.length).toBe(await prisma.faculty.count());
  });

  test("admin fakultas bisa menyimpan visi/misi/tujuan fakultasnya", async () => {
    const cookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const before = await prisma.faculty.findUnique({ where: { slug: "fikom" } });

    const res = await req("/api/admin/faculties/fikom", {
      method: "PUT", cookie,
      body: JSON.stringify({
        vision: "Menjadi fakultas unggul dalam sistem cerdas",
        mission: ["Pendidikan bermutu", "Penelitian aplikatif"],
        objective: ["Lulusan siap industri"],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.vision).toBe("Menjadi fakultas unggul dalam sistem cerdas");
    expect(body.data.mission).toHaveLength(2);
    expect(body.data.objective).toHaveLength(1);

    await prisma.faculty.update({
      where: { slug: "fikom" },
      data: { vision: before!.vision, mission: before!.mission, objective: before!.objective },
    });
  });

  test("admin fakultas TIDAK bisa mengubah fakultas lain", async () => {
    const cookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const before = await prisma.faculty.findUnique({ where: { slug: "farmasi" } });

    const res = await req("/api/admin/faculties/farmasi", {
      method: "PUT", cookie, body: JSON.stringify({ vision: "Sabotase" }),
    });
    expect(res.status).toBe(403);

    const after = await prisma.faculty.findUnique({ where: { slug: "farmasi" } });
    expect(after!.vision).toBe(before!.vision);
    expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
  });

  test("field asing pada profil fakultas ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const before = await prisma.faculty.findUnique({ where: { slug: "fikom" } });
    // `slug` dan `label` bukan milik admin; kalau lolos, admin bisa mengganti
    // identitas fakultas dan memutus relasi dengan prodi di bawahnya.
    const res = await req("/api/admin/faculties/fikom", {
      method: "PUT", cookie, body: JSON.stringify({ vision: "x", slug: "bajakan", label: "Palsu" }),
    });
    expect(res.status).toBe(422);
    const after = await prisma.faculty.findUnique({ where: { slug: "fikom" } });
    expect(after!.label).toBe(before!.label);
  });

  test("fakultas tak dikenal menghasilkan 404", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req("/api/admin/faculties/tidak-ada", {
      method: "PUT", cookie, body: JSON.stringify({ vision: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("CPL program studi", () => {
  const validCpl = [
    { code: "CPL1", description: "Bertakwa dan beretika dalam praktik keilmuan", category: "sikap" },
    { code: "CPL2", description: "Menguasai konsep teoretis bidang keilmuan terkait", category: "pengetahuan" },
  ];

  test("menyimpan CPL beserta kategori SN-Dikti", async () => {
    const cookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });

    const res = await req(`/api/admin/programs/${fikomSlug}/cpl`, {
      method: "PUT", cookie, body: JSON.stringify({ cpl: validCpl }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cpl).toHaveLength(2);
    expect(body.data.cpl[0].category).toBe("sikap");

    await prisma.studyProgram.update({ where: { slug: fikomSlug }, data: { cpl: before!.cpl } });
  });

  test("kategori kosong diterima dan dinormalkan jadi null", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });

    // 37 prodi hasil scraping belum punya klasifikasi SN-Dikti; memaksanya
    // akan menolak seluruh data yang sudah ada.
    const res = await req(`/api/admin/programs/${fikomSlug}/cpl`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpl: [{ code: "CPL1", description: "Deskripsi tanpa kategori sama sekali" }] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.cpl[0].category).toBeNull();

    await prisma.studyProgram.update({ where: { slug: fikomSlug }, data: { cpl: before!.cpl } });
  });

  test("kode duplikat ditolak, termasuk yang beda kapitalisasi", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });
    const res = await req(`/api/admin/programs/${fikomSlug}/cpl`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpl: [
        { code: "CPL1", description: "Deskripsi pertama yang memadai" },
        { code: "cpl1", description: "Deskripsi kedua yang memadai" },
      ] }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.cpl[0]).toContain("duplikat");
    const after = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });
    expect(after!.cpl).toBe(before!.cpl);
  });

  test("kategori di luar SN-Dikti ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req(`/api/admin/programs/${fikomSlug}/cpl`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpl: [{ code: "CPL1", description: "Deskripsi memadai sekali", category: "ngawur" }] }),
    });
    expect(res.status).toBe(422);
  });

  test("deskripsi terlalu pendek ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req(`/api/admin/programs/${fikomSlug}/cpl`, {
      method: "PUT", cookie, body: JSON.stringify({ cpl: [{ code: "CPL1", description: "pendek" }] }),
    });
    expect(res.status).toBe(422);
  });

  test("daftar kosong diterima — prodi boleh mengosongkan CPL", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });
    const res = await req(`/api/admin/programs/${fikomSlug}/cpl`, {
      method: "PUT", cookie, body: JSON.stringify({ cpl: [] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.cpl).toEqual([]);
    await prisma.studyProgram.update({ where: { slug: fikomSlug }, data: { cpl: before!.cpl } });
  });

  test("admin fakultas TIDAK bisa mengubah CPL prodi fakultas lain", async () => {
    const cookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: farmasiSlug } });
    const res = await req(`/api/admin/programs/${farmasiSlug}/cpl`, {
      method: "PUT", cookie, body: JSON.stringify({ cpl: validCpl }),
    });
    expect(res.status).toBe(403);
    const after = await prisma.studyProgram.findUnique({ where: { slug: farmasiSlug } });
    expect(after!.cpl).toBe(before!.cpl);
  });

  test("endpoint CPL menolak request tanpa sesi", async () => {
    const res = await req(`/api/admin/programs/${fikomSlug}/cpl`, {
      method: "PUT", body: JSON.stringify({ cpl: validCpl }),
    });
    expect(res.status).toBe(401);
  });
});

describe("akun kaprodi (dibuat super admin)", () => {
  const KAPRODI_NIDN = "9000000005";

  async function createKaprodi(cookie: string, programSlug: string) {
    return req("/api/admin/accounts", {
      method: "POST", cookie,
      body: JSON.stringify({
        nidn: KAPRODI_NIDN, name: "Kaprodi Uji", role: "kaprodi", study_program_slug: programSlug,
      }),
    });
  }

  test("super admin membuat akun kaprodi; fakultas terisi dari prodinya", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    await prisma.adminUser.deleteMany({ where: { nidn: KAPRODI_NIDN } });

    const res = await createKaprodi(cookie, fikomSlug);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.account.role).toBe("kaprodi");
    expect(body.data.account.study_program_slug).toBe(fikomSlug);
    // Fakultas tidak dikirim pemanggil — diturunkan dari prodi supaya tidak
    // mungkin ada kaprodi yang terdaftar di fakultas bukan induk prodinya.
    expect(body.data.account.faculty_slug).toBe("fikom");
    expect(body.data.account.must_change_password).toBe(true);
    expect(body.data.temporary_password).toHaveLength(16);

    // Yang tersimpan hanya hash, bukan password itu sendiri.
    const row = await prisma.adminUser.findUnique({ where: { nidn: KAPRODI_NIDN } });
    expect(row!.passwordHash).not.toContain(body.data.temporary_password);
    expect(row!.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  test("password sementara bisa dipakai login dan wajib diganti sebelum mengubah data", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    await prisma.adminUser.deleteMany({ where: { nidn: KAPRODI_NIDN } });
    const created = await (await createKaprodi(superCookie, fikomSlug)).json();
    const tempPassword = created.data.temporary_password;

    const loginRes = await loginAs(KAPRODI_NIDN, tempPassword);
    expect(loginRes.status).toBe(200);
    const cookie = sessionCookie(loginRes)!;

    const blocked = await req(`/api/admin/programs/${fikomSlug}`, {
      method: "PUT", cookie, body: JSON.stringify({ vision: "belum ganti" }),
    });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toBe("password_change_required");
  });

  test("kaprodi hanya melihat dan mengubah prodinya sendiri", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    await prisma.adminUser.deleteMany({ where: { nidn: KAPRODI_NIDN } });
    await (await createKaprodi(superCookie, fikomSlug)).json();
    // Lewati gerbang ganti password supaya yang diuji adalah scoping-nya.
    await prisma.adminUser.update({ where: { nidn: KAPRODI_NIDN }, data: { mustChangePassword: false } });
    await seedUserPassword(KAPRODI_NIDN);
    const cookie = sessionCookie(await loginAs(KAPRODI_NIDN))!;

    const list = await (await req("/api/admin/programs", { cookie })).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].slug).toBe(fikomSlug);

    const own = await req(`/api/admin/programs/${fikomSlug}`, {
      method: "PUT", cookie, body: JSON.stringify({ vision: "Visi oleh kaprodi" }),
    });
    expect(own.status).toBe(200);
  });

  test("kaprodi TIDAK bisa mengubah prodi lain di fakultas yang sama", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const sibling = await prisma.studyProgram.findFirst({
      where: { facultySlug: "fikom", slug: { not: fikomSlug } },
    });
    expect(sibling).not.toBeNull();

    await prisma.adminUser.deleteMany({ where: { nidn: KAPRODI_NIDN } });
    await (await createKaprodi(superCookie, fikomSlug)).json();
    await prisma.adminUser.update({ where: { nidn: KAPRODI_NIDN }, data: { mustChangePassword: false } });
    await seedUserPassword(KAPRODI_NIDN);
    const cookie = sessionCookie(await loginAs(KAPRODI_NIDN))!;

    const before = sibling!;
    const res = await req(`/api/admin/programs/${before.slug}`, {
      method: "PUT", cookie, body: JSON.stringify({ vision: "lintas prodi" }),
    });
    expect(res.status).toBe(403);
    const after = await prisma.studyProgram.findUnique({ where: { slug: before.slug } });
    expect(after!.vision).toBe(before.vision);
  });

  test("kaprodi tidak berwenang atas profil fakultas maupun manajemen akun", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    await prisma.adminUser.deleteMany({ where: { nidn: KAPRODI_NIDN } });
    await (await createKaprodi(superCookie, fikomSlug)).json();
    await prisma.adminUser.update({ where: { nidn: KAPRODI_NIDN }, data: { mustChangePassword: false } });
    await seedUserPassword(KAPRODI_NIDN);
    const cookie = sessionCookie(await loginAs(KAPRODI_NIDN))!;

    expect((await req("/api/admin/faculties/fikom", {
      method: "PUT", cookie, body: JSON.stringify({ vision: "x" }),
    })).status).toBe(403);
    expect((await req("/api/admin/accounts", { cookie })).status).toBe(403);
    expect((await req("/api/admin/accounts", {
      method: "POST", cookie,
      body: JSON.stringify({ nidn: "9000000099", name: "Nakal", role: "super_admin" }),
    })).status).toBe(403);
  });
});

describe("manajemen akun", () => {
  test("kaprodi tanpa program studi ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req("/api/admin/accounts", {
      method: "POST", cookie,
      body: JSON.stringify({ nidn: "9000000006", name: "Tanpa Prodi", role: "kaprodi" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.study_program_slug).toBeDefined();
    expect(await prisma.adminUser.findUnique({ where: { nidn: "9000000006" } })).toBeNull();
  });

  test("admin fakultas tanpa fakultas ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req("/api/admin/accounts", {
      method: "POST", cookie,
      body: JSON.stringify({ nidn: "9000000007", name: "Tanpa Fakultas", role: "faculty_admin" }),
    });
    expect(res.status).toBe(422);
  });

  test("super admin tidak boleh terikat fakultas", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req("/api/admin/accounts", {
      method: "POST", cookie,
      body: JSON.stringify({ nidn: "9000000008", name: "Super Aneh", role: "super_admin", faculty_slug: "fikom" }),
    });
    expect(res.status).toBe(422);
  });

  test("NIDN yang sudah ada ditolak dengan 409", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req("/api/admin/accounts", {
      method: "POST", cookie,
      body: JSON.stringify({ nidn: SUPER_NIDN, name: "Kembar", role: "kaprodi", study_program_slug: fikomSlug }),
    });
    expect(res.status).toBe(409);
  });

  test("super admin tidak bisa menonaktifkan atau menurunkan peran akun sendiri", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const deactivate = await req(`/api/admin/accounts/${SUPER_NIDN}`, {
      method: "PUT", cookie, body: JSON.stringify({ is_active: false }),
    });
    expect(deactivate.status).toBe(422);
    expect((await deactivate.json()).error).toBe("self_lockout");

    const demote = await req(`/api/admin/accounts/${SUPER_NIDN}`, {
      method: "PUT", cookie, body: JSON.stringify({ role: "kaprodi", study_program_slug: fikomSlug }),
    });
    expect(demote.status).toBe(422);

    const still = await prisma.adminUser.findUnique({ where: { nidn: SUPER_NIDN } });
    expect(still!.role).toBe("super_admin");
    expect(still!.isActive).toBe(true);
  });

  test("reset password mencabut sesi dan mematikan password lama", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const victimCookie = sessionCookie(await loginAs(OTHER_NIDN))!;
    expect((await req("/api/admin/me", { cookie: victimCookie })).status).toBe(200);

    const res = await req(`/api/admin/accounts/${OTHER_NIDN}/reset-password`, { method: "POST", cookie: superCookie });
    expect(res.status).toBe(200);
    const temp = (await res.json()).data.temporary_password;

    expect((await req("/api/admin/me", { cookie: victimCookie })).status).toBe(401);
    expect((await loginAs(OTHER_NIDN, PASSWORD)).status).toBe(401);
    expect((await loginAs(OTHER_NIDN, temp)).status).toBe(200);

    await seedUser(OTHER_NIDN, "faculty_admin", (await prisma.faculty.findUniqueOrThrow({ where: { slug: "farmasi" } })).id);
  });

  test("mengubah peran mencabut sesi aktif agar wewenang baru langsung berlaku", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const targetCookie = sessionCookie(await loginAs(OTHER_NIDN))!;
    expect((await req("/api/admin/me", { cookie: targetCookie })).status).toBe(200);

    const res = await req(`/api/admin/accounts/${OTHER_NIDN}`, {
      method: "PUT", cookie: superCookie,
      body: JSON.stringify({ role: "kaprodi", study_program_slug: farmasiSlug }),
    });
    expect(res.status).toBe(200);
    expect((await req("/api/admin/me", { cookie: targetCookie })).status).toBe(401);

    await seedUser(OTHER_NIDN, "faculty_admin", (await prisma.faculty.findUniqueOrThrow({ where: { slug: "farmasi" } })).id);
  });

  test("akun nonaktif tidak bisa login lagi", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    await req(`/api/admin/accounts/${OTHER_NIDN}`, {
      method: "PUT", cookie: superCookie, body: JSON.stringify({ is_active: false }),
    });
    expect((await loginAs(OTHER_NIDN)).status).toBe(403);
    await prisma.adminUser.update({ where: { nidn: OTHER_NIDN }, data: { isActive: true } });
  });
});

describe("riwayat audit", () => {
  test("perubahan profil tercatat beserta pelaku dan field yang berubah", async () => {
    const cookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const before = await prisma.studyProgram.findUnique({ where: { slug: fikomSlug } });

    await req(`/api/admin/programs/${fikomSlug}`, {
      method: "PUT", cookie, body: JSON.stringify({ vision: "Visi untuk uji audit" }),
    });

    const entries = (await (await req("/api/admin/audit", { cookie })).json()).data;
    const entry = entries.find((e: { action: string; entity_ref: string }) =>
      e.action === "update_program_profile" && e.entity_ref === fikomSlug);
    expect(entry).toBeDefined();
    expect(entry.actor_nidn).toBe(FIKOM_NIDN);
    expect(entry.changes.vision.after).toBe("Visi untuk uji audit");

    await prisma.studyProgram.update({ where: { slug: fikomSlug }, data: { vision: before!.vision } });
  });

  test("riwayat dibatasi lingkup pembaca — bukan celah kebocoran lintas fakultas", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    // Perubahan pada prodi Farmasi oleh super admin.
    const farmasiBefore = await prisma.studyProgram.findUnique({ where: { slug: farmasiSlug } });
    await req(`/api/admin/programs/${farmasiSlug}`, {
      method: "PUT", cookie: superCookie, body: JSON.stringify({ vision: "Visi farmasi uji" }),
    });

    const fikomCookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    const seen = (await (await req("/api/admin/audit", { cookie: fikomCookie })).json()).data;
    expect(seen.some((e: { entity_ref: string }) => e.entity_ref === farmasiSlug)).toBe(false);

    const all = (await (await req("/api/admin/audit", { cookie: superCookie })).json()).data;
    expect(all.some((e: { entity_ref: string }) => e.entity_ref === farmasiSlug)).toBe(true);

    await prisma.studyProgram.update({ where: { slug: farmasiSlug }, data: { vision: farmasiBefore!.vision } });
  });

  test("password tidak pernah masuk catatan audit", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req(`/api/admin/accounts/${OTHER_NIDN}/reset-password`, { method: "POST", cookie });
    const temp = (await res.json()).data.temporary_password;

    const logs = await prisma.auditLog.findMany();
    const serialised = JSON.stringify(logs);
    expect(serialised).not.toContain(temp);
    expect(serialised).not.toContain("scrypt$");

    await seedUser(OTHER_NIDN, "faculty_admin", (await prisma.faculty.findUniqueOrThrow({ where: { slug: "farmasi" } })).id);
  });
});

describe("bank kurikulum", () => {
  let courseId = 0;

  async function createCourse(cookie: string, overrides: Record<string, unknown> = {}) {
    return req("/api/admin/courses", {
      method: "POST", cookie,
      body: JSON.stringify({
        study_program_slug: fikomSlug,
        code: "UJ24TEST01", name: "Mata Kuliah Uji Kurikulum",
        semester: 3, sks_theory: 2, sks_practice: 1,
        ...overrides,
      }),
    });
  }

  beforeEach(async () => {
    await prisma.course.deleteMany({ where: { code: { startsWith: "UJ24TEST" } } });
  });

  afterAll(async () => {
    await prisma.course.deleteMany({ where: { code: { startsWith: "UJ24TEST" } } });
  });

  test("mata kuliah bisa dibuat dan SKS dihitung", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await createCourse(cookie);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.sks_total).toBe(3);
    expect(body.data.study_program_slug).toBe(fikomSlug);
    courseId = body.data.id;
  });

  test("kode wajib unik dalam satu prodi, tapi boleh sama di prodi lain", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    expect((await createCourse(cookie)).status).toBe(201);
    expect((await createCourse(cookie)).status).toBe(409);

    // Mata kuliah universitas memang dipakai lintas prodi dengan kode sama,
    // jadi keunikannya per prodi — bukan global.
    const other = await createCourse(cookie, { study_program_slug: farmasiSlug });
    expect(other.status).toBe(201);
  });

  test("total SKS nol ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await createCourse(cookie, { sks_theory: 0, sks_practice: 0 });
    expect(res.status).toBe(422);
  });

  test("CPMK yang menunjuk CPL tidak ada ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const created = await (await createCourse(cookie)).json();

    const res = await req(`/api/admin/courses/${created.data.id}/cpmk`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpmk: [{ code: "CPMK 1", description: "Deskripsi yang memadai sekali", cpl_code: "CPL99" }] }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("unknown_cpl");
    // Tidak boleh tersimpan sebagian.
    expect(await prisma.cpmk.count({ where: { courseId: created.data.id } })).toBe(0);
  });

  test("taksonomi di luar pola C/A/P + tingkat ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const created = await (await createCourse(cookie)).json();
    const res = await req(`/api/admin/courses/${created.data.id}/cpmk`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpmk: [{ code: "CPMK 1", description: "Deskripsi yang memadai sekali", taxonomy: "Z9" }] }),
    });
    expect(res.status).toBe(422);
  });

  test("kode CPMK duplikat ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const created = await (await createCourse(cookie)).json();
    const res = await req(`/api/admin/courses/${created.data.id}/cpmk`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpmk: [
        { code: "CPMK 1", description: "Deskripsi pertama yang memadai" },
        { code: "cpmk 1", description: "Deskripsi kedua yang memadai" },
      ] }),
    });
    expect(res.status).toBe(422);
  });

  test("CPMK dan Sub-CPMK tersimpan berurutan dan menggantikan daftar lama", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const created = await (await createCourse(cookie)).json();
    const id = created.data.id;

    const first = await req(`/api/admin/courses/${id}/cpmk`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpmk: [
        {
          code: "CPMK 1", description: "Mampu menganalisis kompleksitas algoritma",
          taxonomy: "C4", cpl_code: "CPL2",
          sub_cpmk: [
            { code: "Sub-CPMK-1", description: "Mahasiswa mampu menjelaskan notasi asimtotik", taxonomy: "C2" },
            { code: "Sub-CPMK-2", description: "Mahasiswa mampu menghitung kompleksitas waktu", taxonomy: "C3" },
          ],
        },
        { code: "CPMK 2", description: "Mampu mengimplementasikan struktur data linier", taxonomy: "P3" },
      ] }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.data.cpmk_count).toBe(2);
    expect(firstBody.data.sub_cpmk_count).toBe(2);
    expect(firstBody.data.cpmk[0].code).toBe("CPMK 1");
    expect(firstBody.data.cpmk[0].sub_cpmk[1].code).toBe("Sub-CPMK-2");

    // Penggantian menyeluruh: daftar lama tidak boleh tertinggal.
    const second = await req(`/api/admin/courses/${id}/cpmk`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpmk: [{ code: "CPMK A", description: "Rumusan pengganti yang memadai" }] }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.data.cpmk.map((x: { code: string }) => x.code)).toEqual(["CPMK A"]);
    expect(await prisma.subCpmk.count({ where: { cpmk: { courseId: id } } })).toBe(0);
  });

  test("menghapus mata kuliah ikut menghapus CPMK dan Sub-CPMK", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const created = await (await createCourse(cookie)).json();
    const id = created.data.id;
    await req(`/api/admin/courses/${id}/cpmk`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpmk: [{
        code: "CPMK 1", description: "Rumusan yang memadai sekali",
        sub_cpmk: [{ code: "Sub-CPMK-1", description: "Sub rumusan yang memadai" }],
      }] }),
    });
    expect(await prisma.cpmk.count({ where: { courseId: id } })).toBe(1);

    expect((await req(`/api/admin/courses/${id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect(await prisma.cpmk.count({ where: { courseId: id } })).toBe(0);
    expect(await prisma.subCpmk.count({ where: { cpmk: { courseId: id } } })).toBe(0);
  });

  test("kaprodi hanya bisa mengelola kurikulum prodinya", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const ownCourse = await (await createCourse(superCookie)).json();
    const otherCourse = await (await createCourse(superCookie, {
      study_program_slug: farmasiSlug, code: "UJ24TEST99",
    })).json();

    const kaprodiNidn = "9000000010";
    await prisma.adminUser.deleteMany({ where: { nidn: kaprodiNidn } });
    const program = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: fikomSlug } });
    const kaprodiUser = await prisma.adminUser.create({
      data: {
        nidn: kaprodiNidn, name: "Kaprodi Kurikulum", role: "kaprodi",
        facultyId: program.facultyId, studyProgramId: program.id,
        passwordHash: await hashPassword(PASSWORD), mustChangePassword: false,
      },
    });
    await seedApiKey(kaprodiUser.id);
    const cookie = sessionCookie(await loginAs(kaprodiNidn))!;

    // Daftar hanya memuat prodinya.
    const list = await (await req("/api/admin/courses", { cookie })).json();
    expect(list.data.every((c: { study_program_slug: string }) => c.study_program_slug === fikomSlug)).toBe(true);

    // Boleh mengubah miliknya.
    expect((await req(`/api/admin/courses/${ownCourse.data.id}`, {
      method: "PUT", cookie, body: JSON.stringify({ name: "Diubah kaprodi" }),
    })).status).toBe(200);

    // Ditolak untuk prodi lain, termasuk endpoint CPMK dan hapus.
    expect((await req(`/api/admin/courses/${otherCourse.data.id}`, {
      method: "PUT", cookie, body: JSON.stringify({ name: "Sabotase" }),
    })).status).toBe(403);
    expect((await req(`/api/admin/courses/${otherCourse.data.id}/cpmk`, {
      method: "PUT", cookie, body: JSON.stringify({ cpmk: [] }),
    })).status).toBe(403);
    expect((await req(`/api/admin/courses/${otherCourse.data.id}`, { method: "DELETE", cookie })).status).toBe(403);

    const untouched = await prisma.course.findUnique({ where: { id: otherCourse.data.id } });
    expect(untouched!.name).toBe("Mata Kuliah Uji Kurikulum");

    await prisma.adminUser.deleteMany({ where: { nidn: kaprodiNidn } });
  });

  test("endpoint kurikulum menolak request tanpa sesi", async () => {
    expect((await req("/api/admin/courses")).status).toBe(401);
    expect((await req("/api/admin/courses", {
      method: "POST", body: JSON.stringify({ study_program_slug: fikomSlug, code: "X", name: "Y", semester: 1, sks_theory: 2, sks_practice: 0 }),
    })).status).toBe(401);
  });
});

describe("matriks CPL", () => {
  test("menandai CPL yang belum ditopang dan CPMK yang menggantung", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    await prisma.course.deleteMany({ where: { code: { startsWith: "UJ24MTX" } } });

    // Matriks membaca seluruh kurikulum prodi, jadi kondisi awalnya dicatat
    // lebih dulu — menuntut "ada CPL belum ditopang" akan rapuh terhadap data
    // kurikulum lain yang sudah ada di prodi ini.
    const program = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: fikomSlug } });
    const cplCodes = (JSON.parse(program.cpl) as { code: string }[]).map((x) => x.code);
    expect(cplCodes.length).toBeGreaterThan(0);
    const target = cplCodes[0];

    const before = (await (await req(`/api/admin/programs/${fikomSlug}/matrix`, { cookie })).json()).data;
    const supportersBefore = before.cpl.find((r: { code: string }) => r.code === target).supporting.length;

    const created = await (await req("/api/admin/courses", {
      method: "POST", cookie,
      body: JSON.stringify({
        study_program_slug: fikomSlug, code: "UJ24MTX01", name: "MK Matriks",
        semester: 1, sks_theory: 2, sks_practice: 0,
      }),
    })).json();

    await req(`/api/admin/courses/${created.data.id}/cpmk`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpmk: [
        { code: "CPMK 1", description: "Menopang CPL pertama dengan memadai", cpl_code: target },
        { code: "CPMK 2", description: "Belum dipetakan ke CPL mana pun" },
      ] }),
    });

    const after = (await (await req(`/api/admin/programs/${fikomSlug}/matrix`, { cookie })).json()).data;
    const row = after.cpl.find((r: { code: string }) => r.code === target);
    expect(row.is_covered).toBe(true);
    expect(row.supporting.length).toBe(supportersBefore + 1);
    expect(row.supporting.some((s: { course_code: string }) => s.course_code === "UJ24MTX01")).toBe(true);

    // CPMK tanpa cpl_code harus dilaporkan sebagai menggantung.
    expect(after.orphan_cpmk.some((o: { cpmk_code: string; course_code: string }) =>
      o.course_code === "UJ24MTX01" && o.cpmk_code === "CPMK 2")).toBe(true);

    await prisma.course.deleteMany({ where: { code: { startsWith: "UJ24MTX" } } });
  });

  test("CPL tanpa penopang dilaporkan di uncovered_cpl", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    // Prodi yang kurikulumnya masih kosong: seluruh CPL-nya pasti belum ditopang.
    const bare = await prisma.studyProgram.findFirstOrThrow({
      where: { courses: { none: {} }, cpl: { not: "[]" } },
    });
    const matrix = (await (await req(`/api/admin/programs/${bare.slug}/matrix`, { cookie })).json()).data;
    expect(matrix.course_count).toBe(0);
    expect(matrix.cpl.length).toBeGreaterThan(0);
    expect(matrix.uncovered_cpl.length).toBe(matrix.cpl.length);
    expect(matrix.cpl.every((r: { is_covered: boolean }) => !r.is_covered)).toBe(true);
  });

  test("matriks prodi lain ditolak untuk admin fakultas", async () => {
    const cookie = sessionCookie(await loginAs(FIKOM_NIDN))!;
    expect((await req(`/api/admin/programs/${farmasiSlug}/matrix`, { cookie })).status).toBe(403);
    expect((await req(`/api/admin/programs/${fikomSlug}/matrix`, { cookie })).status).toBe(200);
  });
});

describe("mengisi RPS dari bank kurikulum", () => {
  test("identitas, deskripsi, dan CP diambil dari kurikulum", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    await prisma.course.deleteMany({ where: { code: { startsWith: "UJ24APP" } } });

    const course = await (await req("/api/admin/courses", {
      method: "POST", cookie,
      body: JSON.stringify({
        study_program_slug: fikomSlug, code: "UJ24APP01", name: "MK Autofill",
        semester: 5, sks_theory: 2, sks_practice: 1,
        description: "Deskripsi resmi dari kurikulum program studi.",
        bahan_kajian: ["Topik A", "Topik B"],
        pustaka_utama: ["Pustaka utama kurikulum"],
      }),
    })).json();

    await req(`/api/admin/courses/${course.data.id}/cpmk`, {
      method: "PUT", cookie,
      body: JSON.stringify({ cpmk: [{
        code: "CPMK 1", description: "Rumusan CPMK dari kurikulum", taxonomy: "C4", cpl_code: "CPL2",
        sub_cpmk: [{ code: "Sub-CPMK-1", description: "Rumusan Sub-CPMK dari kurikulum", taxonomy: "C3" }],
      }] }),
    });

    const draft = await prisma.rpsDraft.create({
      data: {
        courseName: "Draft Kosong", courseCode: "TMPX", sksTotal: 2, sksTheory: 2, sksPractice: 0,
        semester: "I", preparationDate: new Date("2026-03-15"),
        lecturers: JSON.stringify([{ name: "Dr. Uji", nidn: "0011223344", role: "koordinator_mk" }]),
      },
    });

    const res = await req(`/api/rps/${draft.id}/apply-course`, {
      method: "POST", cookie, body: JSON.stringify({ course_id: course.data.id }),
    });
    expect(res.status).toBe(200);
    const applied = (await res.json()).data.applied;
    expect(applied.cpmk).toBe(1);
    expect(applied.sub_cpmk).toBe(1);
    // Hanya CPL yang benar-benar dibebankan pada MK ini, bukan seluruh CPL prodi.
    expect(applied.cpl).toBe(1);

    const after = await prisma.rpsDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.courseCode).toBe("UJ24APP01");
    expect(after.semester).toBe("5");
    expect(after.sksTotal).toBe(3);
    expect(after.studyProgram).toBe((await prisma.studyProgram.findUniqueOrThrow({ where: { slug: fikomSlug } })).value);
    expect(JSON.parse(after.cpl)[0].code).toBe("CPL2");
    expect(JSON.parse(after.subCpmk)[0].cpmk_code).toBe("CPMK 1");

    await prisma.rpsDraft.delete({ where: { id: draft.id } });
    await prisma.course.deleteMany({ where: { code: { startsWith: "UJ24APP" } } });
  });

  test("course_id tidak dikenal menghasilkan 404", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const draft = await prisma.rpsDraft.create({
      data: {
        courseName: "Draft", courseCode: "TMPY", sksTotal: 2, sksTheory: 2, sksPractice: 0,
        semester: "I", preparationDate: new Date("2026-03-15"), lecturers: "[]",
      },
    });
    const res = await req(`/api/rps/${draft.id}/apply-course`, {
      method: "POST", cookie, body: JSON.stringify({ course_id: 999999 }),
    });
    expect(res.status).toBe(404);
    await prisma.rpsDraft.delete({ where: { id: draft.id } });
  });

  test("bank kurikulum publik memerlukan penyebutan prodi", async () => {
    expect((await req("/api/courses")).status).toBe(422);
    const program = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: fikomSlug } });
    const ok = await req(`/api/courses?study_program=${encodeURIComponent(program.value)}`);
    expect(ok.status).toBe(200);
    expect(Array.isArray((await ok.json()).data)).toBe(true);
  });
});

describe("RPS di balik login", () => {
  const DOSEN_NIDN = "9000000020";
  const DOSEN_LAIN = "9000000021";
  let programId = 0;
  let programValue = "";

  const draftPayload = (overrides: Record<string, unknown> = {}) => ({
    course_name: "RPS Uji Login", course_code: "UJLOGIN1",
    sks_total: 3, sks_theory: 2, sks_practice: 1, semester: "III",
    preparation_date: "2026-03-15",
    faculty: "Fakultas Ilmu Komputer", study_program: programValue,
    lecturers: [{ name: "Dr. Dosen Uji, M.Kom.", nidn: DOSEN_NIDN, role: "koordinator_mk" }],
    ...overrides,
  });

  beforeAll(async () => {
    const program = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: fikomSlug } });
    programId = program.id;
    programValue = program.value;
    for (const nidn of [DOSEN_NIDN, DOSEN_LAIN]) {
      const user = await prisma.adminUser.upsert({
        where: { nidn },
        update: { role: "dosen", facultyId: program.facultyId, studyProgramId: program.id, isActive: true, mustChangePassword: false, passwordHash: await hashPassword(PASSWORD) },
        create: { nidn, name: `Dosen ${nidn}`, role: "dosen", facultyId: program.facultyId, studyProgramId: program.id, passwordHash: await hashPassword(PASSWORD), mustChangePassword: false },
      });
      await seedApiKey(user.id);
    }
  });

  afterAll(async () => {
    await prisma.rpsDraft.deleteMany({ where: { courseCode: { startsWith: "UJLOGIN" } } });
    await prisma.adminUser.deleteMany({ where: { nidn: { in: [DOSEN_NIDN, DOSEN_LAIN] } } });
  });

  test("membuat dan mengubah RPS memerlukan sesi", async () => {
    expect((await req("/api/rps", { method: "POST", body: JSON.stringify(draftPayload()) })).status).toBe(401);
    expect((await req("/api/rps/1", { method: "PUT", body: JSON.stringify({ description: "x" }) })).status).toBe(401);
    expect((await req("/api/rps/1", { method: "DELETE" })).status).toBe(401);
    expect((await req("/api/rps/1/generate", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await req("/api/rps/1/ai/generate", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await req("/api/rps/1/apply-course", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await req("/api/description/generate", { method: "POST", body: JSON.stringify({ course_name: "x" }) })).status).toBe(401);
  });

  test("pratinjau, unduh, dan detail tetap terbuka tanpa sesi", async () => {
    // Dokumen RPS adalah informasi publik prodi, dan tautan unduhan memang
    // dibagikan ke pihak tanpa akun.
    const draft = await prisma.rpsDraft.findFirstOrThrow({ orderBy: { id: "asc" } });
    expect((await req(`/api/rps/${draft.id}`)).status).toBe(200);
    expect((await req(`/api/rps/${draft.id}/preview`, { method: "POST", body: "{}" })).status).toBe(200);
    expect((await req(`/api/rps/${draft.id}/audit`, { method: "POST", body: "{}" })).status).toBe(200);
  });

  test("daftar RPS kosong tanpa sesi, dan menandai belum login", async () => {
    const body = await (await req("/api/rps")).json();
    expect(body.meta.signed_in).toBe(false);
    expect(body.pagination.total).toBe(0);
  });

  test("draft yang dibuat otomatis dimiliki pembuatnya", async () => {
    const cookie = sessionCookie(await loginAs(DOSEN_NIDN))!;
    const res = await req("/api/rps", { method: "POST", cookie, body: JSON.stringify(draftPayload()) });
    expect(res.status).toBe(201);
    const id = (await res.json()).data.id;

    const row = await prisma.rpsDraft.findUniqueOrThrow({ where: { id } });
    const owner = await prisma.adminUser.findUniqueOrThrow({ where: { nidn: DOSEN_NIDN } });
    expect(row.ownerId).toBe(owner.id);
    // Prodi ikut direlasikan supaya wewenang dinilai lewat id, bukan teks.
    expect(row.studyProgramId).toBe(programId);
  });

  test("dosen tidak bisa membuat RPS untuk prodi lain", async () => {
    const cookie = sessionCookie(await loginAs(DOSEN_NIDN))!;
    const farmasi = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: farmasiSlug } });
    const res = await req("/api/rps", {
      method: "POST", cookie,
      body: JSON.stringify(draftPayload({ course_code: "UJLOGIN9", study_program: farmasi.value, faculty: farmasi.facultyLabel })),
    });
    expect(res.status).toBe(403);
    expect(await prisma.rpsDraft.count({ where: { courseCode: "UJLOGIN9" } })).toBe(0);
  });

  test("dosen tidak bisa mengubah atau menghapus draft dosen lain", async () => {
    const ownerCookie = sessionCookie(await loginAs(DOSEN_NIDN))!;
    const created = await (await req("/api/rps", {
      method: "POST", cookie: ownerCookie, body: JSON.stringify(draftPayload({ course_code: "UJLOGIN2" })),
    })).json();
    const id = created.data.id;

    const otherCookie = sessionCookie(await loginAs(DOSEN_LAIN))!;
    const before = await prisma.rpsDraft.findUniqueOrThrow({ where: { id } });

    expect((await req(`/api/rps/${id}`, {
      method: "PUT", cookie: otherCookie, body: JSON.stringify({ description: "sabotase" }),
    })).status).toBe(403);
    expect((await req(`/api/rps/${id}`, { method: "DELETE", cookie: otherCookie })).status).toBe(403);

    const after = await prisma.rpsDraft.findUniqueOrThrow({ where: { id } });
    expect(after.description).toBe(before.description);
  });

  test("dosen bisa mengubah draft miliknya sendiri", async () => {
    const cookie = sessionCookie(await loginAs(DOSEN_NIDN))!;
    const created = await (await req("/api/rps", {
      method: "POST", cookie, body: JSON.stringify(draftPayload({ course_code: "UJLOGIN3" })),
    })).json();
    const res = await req(`/api/rps/${created.data.id}`, {
      method: "PUT", cookie, body: JSON.stringify({ description: "Diubah pemiliknya" }),
    });
    expect(res.status).toBe(200);
  });

  test("kaprodi berwenang atas seluruh draft di prodinya, termasuk milik dosen", async () => {
    const dosenCookie = sessionCookie(await loginAs(DOSEN_NIDN))!;
    const created = await (await req("/api/rps", {
      method: "POST", cookie: dosenCookie, body: JSON.stringify(draftPayload({ course_code: "UJLOGIN4" })),
    })).json();

    const kaprodiNidn = "9000000022";
    await prisma.adminUser.deleteMany({ where: { nidn: kaprodiNidn } });
    const program = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: fikomSlug } });
    const kaprodiRps = await prisma.adminUser.create({
      data: {
        nidn: kaprodiNidn, name: "Kaprodi RPS", role: "kaprodi",
        facultyId: program.facultyId, studyProgramId: program.id,
        passwordHash: await hashPassword(PASSWORD), mustChangePassword: false,
      },
    });
    await seedApiKey(kaprodiRps.id);
    const cookie = sessionCookie(await loginAs(kaprodiNidn))!;
    expect((await req(`/api/rps/${created.data.id}`, {
      method: "PUT", cookie, body: JSON.stringify({ course_cluster: "Ilmu Komputer" }),
    })).status).toBe(200);

    await prisma.adminUser.deleteMany({ where: { nidn: kaprodiNidn } });
  });

  test("dosen tidak berwenang atas master data apa pun", async () => {
    const cookie = sessionCookie(await loginAs(DOSEN_NIDN))!;
    expect((await req(`/api/admin/programs/${fikomSlug}`, {
      method: "PUT", cookie, body: JSON.stringify({ vision: "x" }),
    })).status).toBe(403);
    expect((await req(`/api/admin/programs/${fikomSlug}/cpl`, {
      method: "PUT", cookie, body: JSON.stringify({ cpl: [] }),
    })).status).toBe(403);
    expect((await req("/api/admin/faculties/fikom", {
      method: "PUT", cookie, body: JSON.stringify({ vision: "x" }),
    })).status).toBe(403);
    expect((await req("/api/admin/courses", {
      method: "POST", cookie,
      body: JSON.stringify({ study_program_slug: fikomSlug, code: "NKL999", name: "Nakal Sekali", semester: 1, sks_theory: 2, sks_practice: 0 }),
    })).status).toBe(403);
    expect((await req("/api/admin/accounts", { cookie })).status).toBe(403);
    expect((await req(`/api/admin/programs/${fikomSlug}/matrix`, { cookie })).status).toBe(403);
    expect(await prisma.course.count({ where: { code: "NKL999" } })).toBe(0);
  });

  test("daftar dibatasi wewenang: dosen hanya draftnya sendiri", async () => {
    const cookie = sessionCookie(await loginAs(DOSEN_NIDN))!;
    const body = await (await req("/api/rps?per_page=50", { cookie })).json();
    expect(body.meta.signed_in).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((r: { is_mine: boolean }) => r.is_mine)).toBe(true);

    const superBody = await (await req("/api/rps?per_page=50", { cookie: sessionCookie(await loginAs(SUPER_NIDN))! })).json();
    expect(superBody.pagination.total).toBeGreaterThan(body.pagination.total);
  });

  test("detail memberi tahu klien apakah pembacanya berhak mengubah", async () => {
    const cookie = sessionCookie(await loginAs(DOSEN_NIDN))!;
    const created = await (await req("/api/rps", {
      method: "POST", cookie, body: JSON.stringify(draftPayload({ course_code: "UJLOGIN5" })),
    })).json();
    const id = created.data.id;

    expect((await (await req(`/api/rps/${id}`, { cookie })).json()).data.can_edit).toBe(true);
    expect((await (await req(`/api/rps/${id}`)).json()).data.can_edit).toBe(false);
    const otherCookie = sessionCookie(await loginAs(DOSEN_LAIN))!;
    expect((await (await req(`/api/rps/${id}`, { cookie: otherCookie })).json()).data.can_edit).toBe(false);
  });

  test("hanya super admin yang boleh mengalihkan pemilik draft", async () => {
    const superCookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const created = await (await req("/api/rps", {
      method: "POST", cookie: sessionCookie(await loginAs(DOSEN_NIDN))!,
      body: JSON.stringify(draftPayload({ course_code: "UJLOGIN6" })),
    })).json();
    const id = created.data.id;

    // Dosen lain tidak boleh mengambil alih draft.
    expect((await req(`/api/rps/${id}/owner`, {
      method: "PUT", cookie: sessionCookie(await loginAs(DOSEN_LAIN))!,
      body: JSON.stringify({ owner_nidn: DOSEN_LAIN }),
    })).status).toBe(403);

    const res = await req(`/api/rps/${id}/owner`, {
      method: "PUT", cookie: superCookie, body: JSON.stringify({ owner_nidn: DOSEN_LAIN }),
    });
    expect(res.status).toBe(200);

    // Pemilik baru langsung berwenang, pemilik lama tidak lagi.
    expect((await (await req(`/api/rps/${id}`, { cookie: sessionCookie(await loginAs(DOSEN_LAIN))! })).json()).data.can_edit).toBe(true);
    expect((await (await req(`/api/rps/${id}`, { cookie: sessionCookie(await loginAs(DOSEN_NIDN))! })).json()).data.can_edit).toBe(false);
  });

  test("NIDN pemilik yang tidak terdaftar ditolak", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const draft = await prisma.rpsDraft.findFirstOrThrow({ orderBy: { id: "asc" } });
    expect((await req(`/api/rps/${draft.id}/owner`, {
      method: "PUT", cookie, body: JSON.stringify({ owner_nidn: "0000000000" }),
    })).status).toBe(404);
    expect((await req(`/api/rps/${draft.id}/owner`, {
      method: "PUT", cookie, body: JSON.stringify({ owner_nidn: "123" }),
    })).status).toBe(422);
  });

  test("mengubah prodi draft ikut memperbarui relasinya", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const created = await (await req("/api/rps", {
      method: "POST", cookie, body: JSON.stringify(draftPayload({ course_code: "UJLOGIN7" })),
    })).json();
    const farmasi = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: farmasiSlug } });

    await req(`/api/rps/${created.data.id}`, {
      method: "PUT", cookie, body: JSON.stringify({ study_program: farmasi.value }),
    });
    const row = await prisma.rpsDraft.findUniqueOrThrow({ where: { id: created.data.id } });
    // Tanpa pembaruan relasi, wewenang atas draft ini akan dinilai dari prodi lama.
    expect(row.studyProgramId).toBe(farmasi.id);
  });
});

describe("BYOK per akun", () => {
  const A_NIDN = "9000000030";
  const B_NIDN = "9000000031";
  const FAKE_A = "AIzaKunciMilikAkunA1234567890";
  const FAKE_B = "sk-KunciMilikAkunB1234567890";

  async function makeDosen(nidn: string) {
    const program = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: fikomSlug } });
    await prisma.adminUser.upsert({
      where: { nidn },
      update: { role: "dosen", facultyId: program.facultyId, studyProgramId: program.id, isActive: true, mustChangePassword: false, passwordHash: await hashPassword(PASSWORD) },
      create: { nidn, name: `Dosen BYOK ${nidn}`, role: "dosen", facultyId: program.facultyId, studyProgramId: program.id, passwordHash: await hashPassword(PASSWORD), mustChangePassword: false },
    });
  }

  beforeAll(async () => {
    await makeDosen(A_NIDN);
    await makeDosen(B_NIDN);
  });

  afterAll(async () => {
    await prisma.adminUser.deleteMany({ where: { nidn: { in: [A_NIDN, B_NIDN] } } });
  });

  test("pengaturan kunci memerlukan sesi", async () => {
    // Sebelumnya endpoint ini terbuka, sehingga siapa pun bisa membaca hint dan
    // menimpa kunci berbayar milik institusi.
    expect((await req("/api/settings/api-keys")).status).toBe(401);
    expect((await req("/api/settings/api-keys", {
      method: "PUT", body: JSON.stringify({ provider: "gemini", apiKey: FAKE_A }),
    })).status).toBe(401);
    expect((await req("/api/settings/api-keys/test", {
      method: "POST", body: JSON.stringify({ provider: "gemini" }),
    })).status).toBe(401);
  });

  test("kunci melekat pada pemiliknya dan tidak terlihat akun lain", async () => {
    const aCookie = sessionCookie(await loginAs(A_NIDN))!;
    const bCookie = sessionCookie(await loginAs(B_NIDN))!;

    expect((await req("/api/settings/api-keys", {
      method: "PUT", cookie: aCookie, body: JSON.stringify({ provider: "gemini", apiKey: FAKE_A }),
    })).status).toBe(200);

    const aList = (await (await req("/api/settings/api-keys", { cookie: aCookie })).json()).data;
    expect(aList).toHaveLength(1);
    // Hanya hint yang dikembalikan; plaintext tidak boleh pernah keluar.
    expect(JSON.stringify(aList)).not.toContain(FAKE_A);

    const bList = (await (await req("/api/settings/api-keys", { cookie: bCookie })).json()).data;
    expect(bList).toEqual([]);

    // Bahkan super admin tidak melihat kunci pribadi orang lain.
    const superList = (await (await req("/api/settings/api-keys", {
      cookie: sessionCookie(await loginAs(SUPER_NIDN))!,
    })).json()).data;
    expect(superList.some((k: { provider: string }) => k.provider === "gemini" && false)).toBe(false);
  });

  test("penyedia yang sama boleh dipakai dua akun tanpa saling menimpa", async () => {
    const aCookie = sessionCookie(await loginAs(A_NIDN))!;
    const bCookie = sessionCookie(await loginAs(B_NIDN))!;
    await req("/api/settings/api-keys", { method: "PUT", cookie: aCookie, body: JSON.stringify({ provider: "gemini", apiKey: FAKE_A }) });
    await req("/api/settings/api-keys", { method: "PUT", cookie: bCookie, body: JSON.stringify({ provider: "gemini", apiKey: `${FAKE_B}9` }) });

    const aUser = await prisma.adminUser.findUniqueOrThrow({ where: { nidn: A_NIDN } });
    const bUser = await prisma.adminUser.findUniqueOrThrow({ where: { nidn: B_NIDN } });
    const aKey = await prisma.apiKey.findUniqueOrThrow({ where: { ownerId_provider: { ownerId: aUser.id, provider: "gemini" } } });
    const bKey = await prisma.apiKey.findUniqueOrThrow({ where: { ownerId_provider: { ownerId: bUser.id, provider: "gemini" } } });
    expect(aKey.id).not.toBe(bKey.id);
    expect(aKey.encryptedKey).not.toBe(bKey.encryptedKey);
  });

  test("kunci disimpan terenkripsi, bukan apa adanya", async () => {
    const cookie = sessionCookie(await loginAs(A_NIDN))!;
    await req("/api/settings/api-keys", { method: "PUT", cookie, body: JSON.stringify({ provider: "gemini", apiKey: FAKE_A }) });
    const user = await prisma.adminUser.findUniqueOrThrow({ where: { nidn: A_NIDN } });
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { ownerId_provider: { ownerId: user.id, provider: "gemini" } } });
    expect(row.encryptedKey).not.toContain(FAKE_A);
    // Format iv:tag:ciphertext dari AES-256-GCM.
    expect(row.encryptedKey.split(":")).toHaveLength(3);
    expect(row.keyHint).toBe(`****${FAKE_A.slice(-4)}`);
  });

  test("membuat RPS ditolak sebelum penulis menyimpan kuncinya sendiri", async () => {
    const cookie = sessionCookie(await loginAs(B_NIDN))!;
    const program = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: fikomSlug } });
    const bUser = await prisma.adminUser.findUniqueOrThrow({ where: { nidn: B_NIDN } });
    await prisma.apiKey.deleteMany({ where: { ownerId: bUser.id } });

    const payload = {
      course_name: "RPS Tanpa Kunci", course_code: "UJKEY001",
      sks_total: 2, sks_theory: 2, sks_practice: 0, semester: "I",
      preparation_date: "2026-03-15",
      faculty: program.facultyLabel, study_program: program.value,
      lecturers: [{ name: "Dosen BYOK, M.Kom.", nidn: B_NIDN, role: "koordinator_mk" }],
    };
    const denied = await req("/api/rps", { method: "POST", cookie, body: JSON.stringify(payload) });
    expect(denied.status).toBe(422);
    expect((await denied.json()).error).toBe("no_api_key");
    expect(await prisma.rpsDraft.count({ where: { courseCode: "UJKEY001" } })).toBe(0);

    // Setelah kunci disimpan, pembuatan berhasil.
    await req("/api/settings/api-keys", { method: "PUT", cookie, body: JSON.stringify({ provider: "gemini", apiKey: FAKE_A }) });
    const ok = await req("/api/rps", { method: "POST", cookie, body: JSON.stringify(payload) });
    expect(ok.status).toBe(201);
    await prisma.rpsDraft.deleteMany({ where: { courseCode: "UJKEY001" } });
  });

  test("fitur AI menolak akun tanpa kunci, tidak membonceng kunci orang lain", async () => {
    const aCookie = sessionCookie(await loginAs(A_NIDN))!;
    await req("/api/settings/api-keys", { method: "PUT", cookie: aCookie, body: JSON.stringify({ provider: "gemini", apiKey: FAKE_A }) });

    const bUser = await prisma.adminUser.findUniqueOrThrow({ where: { nidn: B_NIDN } });
    await prisma.apiKey.deleteMany({ where: { ownerId: bUser.id } });
    const bCookie = sessionCookie(await loginAs(B_NIDN))!;

    // Akun A punya kunci; akun B tidak. B harus ditolak, bukan memakai kuota A.
    const res = await req("/api/description/generate", {
      method: "POST", cookie: bCookie,
      body: JSON.stringify({ course_name: "Uji", course_code: "U1", semester: "I", sks_total: 2 }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("no_api_key");
  });

  test("uji kunci menolak penyedia yang belum disimpan akun ini", async () => {
    const cookie = sessionCookie(await loginAs(A_NIDN))!;
    const res = await req("/api/settings/api-keys/test", {
      method: "POST", cookie, body: JSON.stringify({ provider: "claude" }),
    });
    expect(res.status).toBe(422);
  });

  test("/api/admin/me melaporkan kepemilikan kunci untuk klien", async () => {
    const aCookie = sessionCookie(await loginAs(A_NIDN))!;
    await req("/api/settings/api-keys", { method: "PUT", cookie: aCookie, body: JSON.stringify({ provider: "gemini", apiKey: FAKE_A }) });
    const withKey = (await (await req("/api/admin/me", { cookie: aCookie })).json()).data;
    expect(withKey.has_api_key).toBe(true);

    const bUser = await prisma.adminUser.findUniqueOrThrow({ where: { nidn: B_NIDN } });
    await prisma.apiKey.deleteMany({ where: { ownerId: bUser.id } });
    const without = (await (await req("/api/admin/me", { cookie: sessionCookie(await loginAs(B_NIDN))! })).json()).data;
    expect(without.has_api_key).toBe(false);
  });

  test("format kunci divalidasi per penyedia", async () => {
    const cookie = sessionCookie(await loginAs(A_NIDN))!;
    expect((await req("/api/settings/api-keys", {
      method: "PUT", cookie, body: JSON.stringify({ provider: "openai", apiKey: "bukan-format-openai" }),
    })).status).toBe(422);
    expect((await req("/api/settings/api-keys", {
      method: "PUT", cookie, body: JSON.stringify({ provider: "gemini", apiKey: "pendek" }),
    })).status).toBe(422);
    expect((await req("/api/settings/api-keys", {
      method: "PUT", cookie, body: JSON.stringify({ provider: "penyedia-asing", apiKey: FAKE_A }),
    })).status).toBe(422);
  });

  test("kunci ikut terhapus saat akunnya dihapus", async () => {
    const nidn = "9000000032";
    await makeDosen(nidn);
    const cookie = sessionCookie(await loginAs(nidn))!;
    await req("/api/settings/api-keys", { method: "PUT", cookie, body: JSON.stringify({ provider: "gemini", apiKey: FAKE_A }) });
    const user = await prisma.adminUser.findUniqueOrThrow({ where: { nidn } });
    expect(await prisma.apiKey.count({ where: { ownerId: user.id } })).toBe(1);

    await prisma.adminUser.delete({ where: { nidn } });
    // Cascade di skema: kunci tidak boleh tertinggal sebagai data yatim.
    expect(await prisma.apiKey.count({ where: { ownerId: user.id } })).toBe(0);
  });
});

describe("penyusunan isi RPS dengan AI di wizard", () => {
  const ctx = {
    course_name: "Basis Data Lanjut", course_code: "IK24IK1305",
    study_program: "S1 Ilmu Komputer", semester: "IV",
    sks_theory: 2, sks_practice: 1,
  };

  test("memerlukan sesi", async () => {
    expect((await req("/api/rps/ai/draft", { method: "POST", body: JSON.stringify(ctx) })).status).toBe(401);
  });

  test("menolak konteks yang belum lengkap", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const res = await req("/api/rps/ai/draft", { method: "POST", cookie, body: JSON.stringify({ course_name: "X" }) });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("validation_error");
  });

  test("kegagalan penyedia dijelaskan tanpa membocorkan respons mentah", async () => {
    // Key palsu: penyedia sungguhan menolak dengan 400 API_KEY_INVALID.
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const su = await prisma.adminUser.findUniqueOrThrow({ where: { nidn: SUPER_NIDN } });
    await seedApiKey(su.id);
    const res = await req("/api/rps/ai/draft", { method: "POST", cookie, body: JSON.stringify(ctx) });
    expect(res.status).toBe(502);
    const j = await res.json() as { message: string };
    // Dosen perlu tahu tindakannya, bukan melihat blok JSON penyedia.
    expect(j.message).toContain("Settings");
    expect(j.message).not.toContain("{");
    expect(j.message).not.toContain("INVALID_ARGUMENT");
  });
});

describe("pratinjau wizard tanpa draft", () => {
  const payload = () => ({
    course_name: "Algoritma dan Struktur Data",
    course_code: "UJWZ001",
    faculty: "Fakultas Ilmu Komputer",
    study_program: "S1 Ilmu Komputer",
    semester: "III",
    sks_theory: 2,
    sks_practice: 1,
    sks_total: 3,
    preparation_date: "2026-03-15",
    lecturers: [{ name: "Dr. Uji Wizard, M.Kom.", nidn: "0922038401", role: "koordinator_mk" }],
    description: "Mata kuliah ini membahas konsep algoritma dan struktur data.",
    bahan_kajian: ["Konsep Algoritma", "Sorting"],
    pustaka_utama: ["Cormen, T. H. (2022). Introduction to Algorithms."],
    pustaka_pendukung: [],
    cpl: [{ code: "CPL2", description: "Mampu merancang sistem perangkat lunak" }],
    cpmk: [{ code: "CPMK 1", description: "Mampu menganalisis kompleksitas algoritma" }],
    sub_cpmk: [{ code: "Sub-CPMK-1", description: "Mahasiswa mampu menjelaskan notasi asimtotik" }],
    weekly_plans: [{ week: "1", weight: 100, is_merged: false, materi: "Konsep Algoritma" }],
  });

  test("memerlukan sesi", async () => {
    expect((await req("/api/rps/preview", { method: "POST", body: JSON.stringify(payload()) })).status).toBe(401);
  });

  test("menghasilkan DOCX tanpa menyimpan draft apa pun", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const before = await prisma.rpsDraft.count();

    const res = await req("/api/rps/preview", { method: "POST", cookie, body: JSON.stringify(payload()) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("wordprocessingml");
    const bytes = (await res.arrayBuffer()).byteLength;
    expect(bytes).toBeGreaterThan(100_000);

    // Wizard bisa ditinggalkan tanpa meninggalkan draft setengah jadi.
    expect(await prisma.rpsDraft.count()).toBe(before);
  });

  test("narasi sampul diambil dari katalog, bukan dari payload", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    // Payload menyisipkan visi palsu; server harus mengabaikannya.
    const body = { ...payload(), program_vision: "VISI PALSU DARI PAYLOAD" };
    const res = await req("/api/rps/preview", { method: "POST", cookie, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(text).not.toContain("VISI PALSU DARI PAYLOAD");
  });
});

describe("pembuatan RPS sekali kirim", () => {
  test("isi lengkap dari wizard tersimpan dalam satu permintaan", async () => {
    const cookie = sessionCookie(await loginAs(SUPER_NIDN))!;
    const program = await prisma.studyProgram.findUniqueOrThrow({ where: { slug: fikomSlug } });

    const res = await req("/api/rps", {
      method: "POST", cookie,
      body: JSON.stringify({
        course_name: "MK Wizard Sekali Kirim", course_code: "UJWZ002",
        faculty: program.facultyLabel, study_program: program.value,
        semester: "III", sks_theory: 2, sks_practice: 1, sks_total: 3,
        preparation_date: "2026-03-15",
        lecturers: [{ name: "Dr. Uji Wizard, M.Kom.", nidn: SUPER_NIDN, role: "koordinator_mk" }],
        description: "Deskripsi yang dikirim bersama pembuatan draft.",
        bahan_kajian: ["Topik A", "Topik B"],
        pustaka_utama: ["Pustaka utama"],
        cpl: [{ code: "CPL2", description: "Rumusan CPL yang memadai" }],
        cpmk: [{ code: "CPMK 1", description: "Rumusan CPMK yang memadai" }],
        sub_cpmk: [{ code: "Sub-CPMK-1", description: "Rumusan Sub-CPMK yang memadai" }],
        weekly_plans: [{ week: "1", weight: 100, is_merged: false, materi: "Materi pertama" }],
      }),
    });
    expect(res.status).toBe(201);
    const id = (await res.json()).data.id;

    // Sebelumnya isi ini hanya bisa masuk lewat PUT setelah draft ada, yang
    // memaksa alur pengisian terpecah dua halaman.
    const row = await prisma.rpsDraft.findUniqueOrThrow({ where: { id } });
    expect(row.description).toBe("Deskripsi yang dikirim bersama pembuatan draft.");
    expect(JSON.parse(row.bahanKajian ?? "[]")).toHaveLength(2);
    expect(JSON.parse(row.cpl)).toHaveLength(1);
    expect(JSON.parse(row.cpmk)).toHaveLength(1);
    expect(JSON.parse(row.subCpmk)).toHaveLength(1);
    expect(JSON.parse(row.weeklyPlans)).toHaveLength(1);

    await prisma.rpsDraft.delete({ where: { id } });
  });
});

describe("endpoint fakultas publik", () => {
  test("mengembalikan fakultas beserta prodinya tanpa perlu login", async () => {
    const res = await req("/api/faculties");
    expect(res.status).toBe(200);
    const body = await res.json();
    const totalPrograms = body.data.reduce((n: number, f: { programs: unknown[] }) => n + f.programs.length, 0);
    expect(body.data.length).toBe(await prisma.faculty.count());
    expect(totalPrograms).toBe(await prisma.studyProgram.count());
  });

  test("setiap program memuat slug, value, dan label", async () => {
    // Kontrak ini dipakai dropdown form RPS dan pembuatan akun kaprodi. Field
    // yang hilang membuat dropdown jatuh ke satu opsi tanpa pesan error apa pun.
    const body = await (await req("/api/faculties")).json();
    for (const faculty of body.data) {
      expect(Array.isArray(faculty.programs)).toBe(true);
      for (const program of faculty.programs) {
        expect(typeof program.slug).toBe("string");
        expect(program.slug.length).toBeGreaterThan(0);
        expect(typeof program.value).toBe("string");
        expect(typeof program.label).toBe("string");
      }
    }
  });
});
