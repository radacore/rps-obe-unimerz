import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // idempotent: update path keeps demo FELLOWSHIP even after rerun
  await prisma.rpsDraft.upsert({
    where: { id: 1 },
    update: {
      courseName: "Ilmu Biomedik Dasar",
      courseCode: "IW21ASK1541",
      courseCluster: "Keperawatan",
      sksTotal: 4, sksTheory: 3, sksPractice: 1,
      semester: "I",
      preparationDate: new Date("2025-06-28"),
    },
    create: {
      courseName: "Ilmu Biomedik Dasar",
      courseCode: "IW21ASK1541",
      courseCluster: "Keperawatan",
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
  console.log("seed done");
}
main().finally(() => prisma.$disconnect());
