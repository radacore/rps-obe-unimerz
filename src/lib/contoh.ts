export type Cp = { code: string; description: string };

// CONTOH 100% — Biomedik Dasar (Keperawatan) — hanya contoh verbatim, bukan default.
// Dipakai hanya saat user klik "Isi CONTOH 100%". Jangan jadikan fallback otomatis
// untuk RPS baru (agar tidak bocor Keperawatan ke prodi lain seperti Ilmu Komputer).
export const CONTOH_CPL: Cp[] = [
  {
    code: "CPL1",
    description:
      "Mampu menjalankan asuhan keperawatan sesuai kode etik keperawatan Indonesia, berpikir logis, kritis, sistematis, dan kreatif, inovatif, bekerjasama dan memiliki kepekaan sosial serta bertanggungjawab secara ilmiah kepada Masyarakat profesi dan klien dengan mengaplikasikan ilmu pengetahuan dan teknologi keperawatan",
  },
  {
    code: "CPL2",
    description:
      "Mampu melakukan edukasi, komunikasi dan kolaborasi dalam memberikan asuhan dan atau pelayanan keperawatan berdasarkan bukti ilmiah terkini",
  },
];

export const CONTOH_CPMK: Cp[] = [
  { code: "CPMK 1", description: "Menjelaskan konsep biolistrik dan biokimia dalam tubuh manusia sebagai dasar keperawatan (CPL 2)" },
  { code: "CPMK 2", description: "Mendeskripsikan struktur dan fungsi tubuh manusia secara umum untuk mendukung praktik keperawatan (CPL 1)" },
  { code: "CPMK 3", description: "Menjelaskan mekanisme seluler impuls saraf dan peran biolistrik dalam penghantaran sinyal tubuh (CPL 1)" },
  { code: "CPMK 4", description: "Menjelaskan keseimbangan cairan dan elektrolit serta regulasinya dalam tubuh manusia (CPL 2)" },
];

export const CONTOH_SUB_CPMK: Cp[] = [
  { code: "Sub-CPMK-1", description: "Mampu menjelaskan konsep biokimia dan biolistrik dalam tubuh manusia (CPMK1)" },
  { code: "Sub-CPMK-2", description: "Mampu menguraikan zat gizi makro & mikro, AKG, kebutuhan gizi individu, serta prinsip dasar diet klinik (CPMK 1)" },
  { code: "Sub-CPMK-3", description: "Mampu menjelaskan Terminologi anatomis dasar, sel dan jaringan pada struktur tubuh manusia(CPMK2)" },
  { code: "Sub-CPMK-4", description: "Mampu Menjelaskan struktur & fungsi sistem tubuh manusia pada kondisi fisiologis (CPMK2)" },
  { code: "Sbu-CPMK-5", description: "Mampu menjelaskan mekanisme seluler impuls saraf  (CPMK3)" },
  { code: "Sub-CPMK-6", description: "Mampu menjelaskan keseimbangan cairan, asam basa, pH, dan sistem buffer tubuh  pada kondisi fisiologis (CPMK4)" },
  { code: "Sub-CPMK-7", description: "Mampu  menganalisis regulasi hormonal pada keseimbangan cairan & elektrolit (CPMK4)" },
];

export const CONTOH_DESCRIPTION =
  "Mata kuliah ini merupakan bagian dari kelompok ilmu alam dasar yang membahas tentang konsep biologi, fisika, biokimia, gizi dengan memperhatikan lingkungan dan etika keilmuan, serta konsep-konsep anatomi dan fisiologi manusia dalam mempertahankan homeostasis tubuh.";

export const CONTOH_BAHAN_KAJIAN: string[] = [
  "Biologi Sel dan Genetika",
  "Biolistrik pada tubuh manusia",
  "Komponen biokimia dalam tubuh manusia : keseimbangan asam basa, cairan tubuh, metabolisme karbohidrat, protein, lipid, asam nukleat, purin dan pirimidin",
  "Gizi : zat gizi makro dan mikro, angka kecukupan gizi yang dianjurkan, kebutuhan gizi individu, penilaian status gizi individu, penilaian status gizi individu, dasar-dasar diet klinik",
  "Struktur dan fungsi tubuh manusia secara umum",
  "Terminologi anatomis dasar ; posisi tubuh, regio, direction, potongan dan belahan, body cavities, regio dan kuadran",
  "Sel dan jaringan",
  "Sistem persarafan",
  "Sistem endokrin",
  "Sistem reproduksi",
  "Sistem perkemihan",
  "Sistem integumen",
  "Sistem muskuloskeletal",
  "Sistem respirasi",
  "Sistem kardiovaskuler",
  "Sistem pencernaan dan metabolisme tubuh",
  "Sistem imun dasar",
  "Mekanisme seluler impuls saraf",
  "Konsep Biolistrik",
  "Atom dan ion, muatan listrik, potensial arus dan hambatan listrik",
  "Potensial listrik pada berbagai keadaan sel (transduksi sinyal ; potensial membran istirahat, depolarisasi, hiperpolarisasi, potensial aksi)",
  "Penghantaran impuls di dalam tubuh dan transmisi sinaps; potensial end plate, pembentukan excitatory postsynaptic potential (EPSP) dan Inhibitory postsynaptic potential (IPSP)",
  "Penggunaan listrik tubuh",
  "Lengkung Refleks",
  "Pengertian homeostasis dan sistem pengendalian tubuh ; mekanisme umpan balik positif dan negatif",
  "Pengerian dan komponen lengkung refleks",
  "Keseimbangan cairan elektrolit",
  "Kompartemen dan komposisi cairan tubuh",
  "Keseimbangan asam basa ; derajat keasaman larutan (pH) dan sistem buffer tubuh",
  "Regulasi hormonal pada keseimbangan cairan dan elektrolit",
  "Larutan elektrolit dan non elektrolit",
  "Larutan isotonik, hipotonik, dan hipertonik",
];

export const CONTOH_PUSTAKA_UTAMA: string[] = [
  "Cole, I.., & Kramer, P. (2015). Human Physiologi, Biochemistry and Basic Medicine, 1st Edition. Massachusetts:",
  "Academic Press",
  "Chiras, D.D (2019). Human Biology, 9th edition. Massachusetts: Jones & Bartllett Lerning",
  "Cavagna, G. (2019). Fundamentals of Human Physiology. Berlin: Springer",
  "Grodner M., Escott-Stump S., Dorner S. (2016). Nutritional Foundation and Clinical Applications: A Nursing Approach.",
  "6th edition. Mosby: Elsevier Inc",
  "Hall E. (2014). Guyton dan Hall Buku Ajar Fisiologi Kedokteran. Edisi Bahasa Indonesia 12, Saunders: Elsevier",
  "(Singapore) Pte.Ltd.",
  "Jabbar, A.S. (2016). Introduction to Human Physiology. Jordan: Dar Wael for Publishing",
  "Mader SS. (2012). Human Biology, 12th edition. USA: The McGraw-Hill Publishing Company.",
  "Silverthorn, D.U. (2016). Human Physiology: An Integrated Approach (7th edition). London: Pearson",
];

export const CONTOH_PUSTAKA_PENDUKUNG: string[] = [
  "Sherwood, L. (2019). Fisiologi Manusia dari Sel ke Sistem (9 ed.). Jakarta: EGC. Artikel 4",
  "Wahyuni, S., & Rahman, F. (2019). Detection of Pulmonary Function on Active Smokers Whom Regulary Play Wind Instrument “Pui-Pui.” Media Kesehatan Politeknik Kesehatan Makassar, 14(2), 104.",
  "Rahmani, S., & Wahyuni, S. (2022). DETEKSI DINI PERUBAHAN NILAI GDS PADA OLAHRAGAWAN DALAM UPAYA PENCEGAHAN PENGGUNAAN DOPING. Jurnal Keperawatan Silampari, 5(2)",
];
