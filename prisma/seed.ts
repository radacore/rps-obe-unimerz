import { PrismaClient } from "@prisma/client";
import catalog from "./data/final_catalog.json";

const prisma = new PrismaClient();

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

  for (const p of programs) {
    await prisma.studyProgram.upsert({
      where: { slug: p.slug },
      update: {
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
        cpl: JSON.stringify((p as { cpl?: unknown[] }).cpl ?? []),
      },
      create: {
        slug: p.slug,
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
        cpl: JSON.stringify((p as { cpl?: unknown[] }).cpl ?? []),
      },
    });
  }

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
