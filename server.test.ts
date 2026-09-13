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

async function seedUser(nidn: string, role: string, facultyId: number | null, opts?: { isActive?: boolean }) {
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.adminUser.upsert({
    where: { nidn },
    update: { role, facultyId, passwordHash, isActive: opts?.isActive ?? true, mustChangePassword: false, failedAttempts: 0, lockedUntil: null },
    create: { nidn, name: `Uji ${nidn}`, role, facultyId, passwordHash, isActive: opts?.isActive ?? true, mustChangePassword: false },
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
  const nidns = [SUPER_NIDN, FIKOM_NIDN, OTHER_NIDN, INACTIVE_NIDN];
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

describe("endpoint fakultas publik", () => {
  test("mengembalikan fakultas beserta prodinya tanpa perlu login", async () => {
    const res = await req("/api/faculties");
    expect(res.status).toBe(200);
    const body = await res.json();
    const totalPrograms = body.data.reduce((n: number, f: { programs: unknown[] }) => n + f.programs.length, 0);
    expect(body.data.length).toBe(await prisma.faculty.count());
    expect(totalPrograms).toBe(await prisma.studyProgram.count());
  });
});
