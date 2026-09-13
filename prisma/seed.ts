import { PrismaClient } from "@prisma/client";
import catalog from "./data/final_catalog.json";
import { hashPassword, isValidNidn } from "../src/lib/auth";

const prisma = new PrismaClient();

/// Akun awal dibaca dari environment, tidak pernah dari literal di kode.
/// Kalau `SEED_ADMIN_NIDN`/`SEED_ADMIN_PASSWORD` tidak diset, langkah ini
/// dilewati — lebih baik tanpa akun daripada akun berkredensial yang bisa
/// ditebak siapa pun yang membaca repo.
async function seedAdmins(facultyIdBySlug: Map<string, number>) {
  const nidn = process.env.SEED_ADMIN_NIDN?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Super Admin";
  const facultySlug = process.env.SEED_ADMIN_FACULTY?.trim();

  if (!nidn || !password) {
    console.log("seed admin: dilewati (SEED_ADMIN_NIDN / SEED_ADMIN_PASSWORD belum diset)");
    return;
  }
  if (!isValidNidn(nidn)) {
    throw new Error(`SEED_ADMIN_NIDN harus 10 digit angka, dapat "${nidn}"`);
  }
  if (password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD minimal 12 karakter");
  }

  const role = facultySlug ? "faculty_admin" : "super_admin";
  const facultyId = facultySlug ? facultyIdBySlug.get(facultySlug) ?? null : null;
  if (facultySlug && facultyId === null) {
    throw new Error(`SEED_ADMIN_FACULTY "${facultySlug}" tidak ada di katalog fakultas`);
  }

  const passwordHash = await hashPassword(password);
  await prisma.adminUser.upsert({
    where: { nidn },
    // Password TIDAK ditimpa saat re-seed: kalau admin sudah menggantinya,
    // menjalankan `db:seed` lagi tidak boleh mengembalikan kredensial awal.
    update: { name, role, facultyId, isActive: true },
    create: { nidn, name, role, facultyId, passwordHash, mustChangePassword: true },
  });
  console.log(`seed admin: ${nidn} (${role}${facultySlug ? ` @${facultySlug}` : ""}) siap — wajib ganti password saat login pertama`);
}

async function main() {
  const univ = (catalog as { university: { vision: string; mission: string[]; tujuan: string[]; sejarah: string; sourceUrl: string; sourceTimestamp: string } }).university;
  await prisma.universityProfile.upsert({
    where: { id: 1 },
    update: {
      vision: univ.vision,
      mission: JSON.stringify(univ.mission),
      tujuan: JSON.stringify(univ.tujuan),
      sejarah: univ.sejarah,
      sourceUrl: univ.sourceUrl,
      sourceTimestamp: univ.sourceTimestamp,
      verifiedAt: new Date(),
    },
    create: {
      id: 1,
      vision: univ.vision,
      mission: JSON.stringify(univ.mission),
      tujuan: JSON.stringify(univ.tujuan),
      sejarah: univ.sejarah,
      sourceUrl: univ.sourceUrl,
      sourceTimestamp: univ.sourceTimestamp,
      verifiedAt: new Date(),
    },
  });

  const programs = (catalog as { programs: Array<{
    slug: string; facultyLabel: string; facultySlug: string; label: string; value: string;
    akreditasi: string | null; href: string; vision: string | null; mission: string[];
    objective: string[]; graduateProfile: string[]; sourceUrl: string | null; sourceTimestamp: string; completeness: string;
    cpl?: Array<{ code: string; description: string }>;
  }> }).programs;

  // Fakultas diturunkan dari katalog prodi supaya tidak ada daftar kedua yang
  // bisa menyimpang. Visi/misi fakultas sengaja dibiarkan kosong: belum ada
  // sumber terverifikasi, dan admin fakultas yang akan mengisinya.
  const facultyMap = new Map<string, { slug: string; label: string; href: string | null }>();
  for (const p of programs) {
    if (!facultyMap.has(p.facultySlug)) {
      facultyMap.set(p.facultySlug, {
        slug: p.facultySlug,
        label: p.facultyLabel,
        href: p.href ? new URL(p.href).origin + `/${p.facultySlug}/` : null,
      });
    }
  }
  const facultyIdBySlug = new Map<string, number>();
  for (const f of facultyMap.values()) {
    const row = await prisma.faculty.upsert({
      where: { slug: f.slug },
      update: { label: f.label, href: f.href },
      create: { slug: f.slug, label: f.label, href: f.href },
    });
    facultyIdBySlug.set(f.slug, row.id);
  }

  for (const p of programs) {
    const facultyId = facultyIdBySlug.get(p.facultySlug) ?? null;
    const fields = {
      facultyId,
      facultyLabel: p.facultyLabel,
      facultySlug: p.facultySlug,
      label: p.label,
      value: p.value,
      akreditasi: p.akreditasi,
      href: p.href,
      vision: p.vision,
      mission: JSON.stringify(p.mission),
      objective: JSON.stringify(p.objective),
      graduateProfile: JSON.stringify(p.graduateProfile),
      sourceUrl: p.sourceUrl,
      sourceTimestamp: p.sourceTimestamp,
      completeness: p.completeness,
      cpl: JSON.stringify(p.cpl ?? []),
    };
    await prisma.studyProgram.upsert({
      where: { slug: p.slug },
      update: fields,
      create: { slug: p.slug, ...fields },
    });
  }

  await seedAdmins(facultyIdBySlug);


  // Keep demo draft idempotent (matches previous seed)
  await prisma.rpsDraft.upsert({
    where: { id: 1 },
    update: {
      courseName: "Ilmu Biomedik Dasar",
      courseCode: "IW21ASK1541",
      courseCluster: "Keperawatan",
      faculty: "Fakultas Keperawatan dan Kebidanan",
      studyProgram: "S1 Ilmu Keperawatan",
      sksTotal: 4, sksTheory: 3, sksPractice: 1,
      semester: "I",
      preparationDate: new Date("2025-06-28"),
    },
    create: {
      courseName: "Ilmu Biomedik Dasar",
      courseCode: "IW21ASK1541",
      courseCluster: "Keperawatan",
      faculty: "Fakultas Keperawatan dan Kebidanan",
      studyProgram: "S1 Ilmu Keperawatan",
      sksTotal: 4, sksTheory: 3, sksPractice: 1,
      semester: "I",
      preparationDate: new Date("2025-06-28"),
      lecturers: JSON.stringify([
        { name: "Ns. Sri Wahyuni, S.Kep.,M.Kes.", nidn: "001", role: "koordinator_mk" },
        { name: "Ns. Iqwan Syarif, S.Kep.,M.Kep.", nidn: "002", role: "ketua_prodi" },
        { name: "Ns. A. Surahmat, S.Kep.,M.Kep.", nidn: "003", role: "pengembang" },
        { name: "Ns. Syahrul Syamsuddin, S.Kep.,M.Kep.", nidn: "004", role: "anggota" },
        { name: "Ns. Muhammad Saleh, S.Kep.,M.Kep.", nidn: "005", role: "anggota" },
      ]),
      cpl: JSON.stringify([{ code: "CPL1", description: "Mampu menjalankan asuhan keperawatan" }]),
      cpmk: JSON.stringify([]),
      subCpmk: JSON.stringify([]),
      weeklyPlans: JSON.stringify([]),
      mediaMethods: JSON.stringify(["Vercel"]),
      status: "draft",
    },
  });

  const uniCount = await prisma.universityProfile.count();
  const prodiCount = await prisma.studyProgram.count();
  const verified = await prisma.studyProgram.count({ where: { completeness: "verified" } });
  const synthetic = await prisma.studyProgram.count({ where: { completeness: "synthetic-verified" } });
  const missing = await prisma.studyProgram.count({ where: { completeness: "missing" } });
  console.log(`seed done: universityProfile=${uniCount} studyProgram=${prodiCount} verified=${verified} synthetic=${synthetic} missing=${missing}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
