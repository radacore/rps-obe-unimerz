# PRD: RPS OBE Generator — Simple BYOK

## Executive Summary & Product Vision

**RPS OBE Generator (Simple)** adalah web tool single-page tanpa login untuk membuat **Rencana Pembelajaran Semester (RPS) OBE** yang fidelitasnya identik dengan `CONTOH RPS.docx`. Dosen hanya mengisi field teks penting (identitas, deskripsi MK, dosen), menempelkan API Key milik sendiri (BYOK — Bring Your Own Key), dan menekan Generate. Sistem memanggil AI multi-provider (OpenAI + Gemini) untuk menghasilkan **full 16 minggu + CPL/CPMK/Sub-CPMK + RTM + rubrik** secara otomatis, lalu merender `.docx` yang byte-identical via Python `python-docx + lxml`.

Visi: workflow tercepat untuk skripsi/demo — buka URL → isi 8-10 field → pilih provider → Generate → review tabel 16 minggu (editable) → Download DOCX. Tanpa akun, tanpa approval, tanpa admin console. Draft dan API Key disimpan di database terenkripsi untuk persistensi.

## Problem Statement & Target Users

**Problem:** Membuat RPS OBE manual di Word lambat (2–4 jam) dan rawan error: `weight ≠ 100`, minggu ≠ 16, `w:sectPr`/`w:gridCol` rusak, UTS/UAS tidak merge, typo `paian`/`Sbu-CPMK-5` terpropagasi. Solusi enterprise sebelumnya (RBAC, 16 tabel, Redis) terlalu berat untuk skripsi.

**Target Users:**
*   **Dosen / Mahasiswa Skripsi (Single User):** Satu-satunya aktor. Tidak ada login, tidak ada role. Semua pengunjung berbagi tool (single-tenant global, cocok untuk demo VPS pribadi). Mengisi field minimal, mengelola API Key, mereview hasil AI, dan mengunduh DOCX.

## System Scope & User Roles

Scope v1 simple terbatas pada lifecycle: **Input minimal → Simpan draft → Generate AI (16 minggu penuh) → Review/edit → Generate DOCX identik → Download**. Tidak ada LMS, tidak ada kolaborasi realtime.

| Role | Deskripsi | Permissions |
|:---|:---|:---|
| **User (Anonim, tanpa login)** | Satu-satunya pengguna. Tidak ada autentikasi. | - Kelola API Key multi-provider (OpenAI/Gemini) terenkripsi di DB. - CRUD draft RPS (identitas + CPL/CPMK + 16 minggu) via DB. - Generate AI full 16 minggu (BYOK). - Review & edit tabel 16 minggu (TanStack Table). - Generate & download DOCX/PDF identik CONTOH. |

Tidak ada Kaprodi, tidak ada Admin. Semua endpoint public.

## Functional Requirements

### Input & Draft (Tanpa Login)
*   **FR-01: Input Field Minimal (8–10 Field Teks Penting):** Satu halaman stepper 3 langkah dengan field: course name, course code (canonical `IW21ASK1541` — cover `(IW21ASK1541)` sync dengan tabel `R03`, bukan `IW25ASK105431`/`17505R0203`), course cluster, SKS (T/P breakdown, canonical `T=3 P=1 total 4`), semester (I–VIII Ganjil/Genap), preparation date, lecturer list hybrid `[{ name, nidn, role: pengembang|koordinator_mk|ketua_prodi|anggota }]` — 3 slot Otorisasi `R04-R05` (Pengembang, Koordinator MK, Ketua PRODI) + sisa anggota ke `R29` Dosen Pengampu (contoh CONTOH: 5 dosen, Koordinator `Ns. Sri Wahyuni, S.Kep.,M.Kes.`), deskripsi singkat MK `R23` (textarea 3–5 baris), dan opsional CPL/CPMK hint. Validasi: `sks_total = sks_theory + sks_practice`, semester enum, minimal 1 `koordinator_mk`. Kop universitas hardcode `Universitas Megarezky | Fakultas Keperawatan dan Kebidanan | Program Studi S1 Keperawatan dan Pendidikan Profesi Ners` (bukan editable `global_settings`). Data disimpan ke `rps_draft` (Prisma) untuk persistensi draft.
*   **FR-02: Draft Persistence (Simpan di DB):** Setiap save (auto-save debounce 500ms + tombol Simpan) upsert ke `rps_draft` dengan `status: draft`. List draft di `/` dengan search by course name/code, pagination 15, dan aksi Lanjutkan Edit / Hapus / Download. Tanpa versioning — last-write-wins.

### API Key BYOK Multi-Provider
*   **FR-03: Kelola API Key Multi-Provider (DB + Enkripsi):** Halaman `/settings` untuk kelola key per provider (`openai`, `gemini`, extensible ke `claude`). Input `password` dengan eye-toggle, placeholder `sk-...` / `AIza...`, link cara dapat key, tombol **Test Key**. Penyimpanan: `api_key` tabel dengan `encrypted_key` (AES-256-GCM via `APP_ENCRYPTION_KEY` 32-byte), `key_hint` (4 char terakhir untuk mask `sk-****abcd`), tidak pernah return plaintext via GET. PUT upsert per provider, GET hanya mask. Key dikirim ke AI provider ephemeral per request, tidak di-log.

### AI Full 16 Minggu
*   **FR-04: Generate AI Full 16 Minggu + CPL/CPMK/Sub-CPMK:** Tombol `Generate 16 Minggu dengan AI` pada Step 3. Memanggil `POST /api/rps/{id}/ai/generate { provider, model }`. Server: ambil draft + decrypt key provider → panggil adaptor (`OpenAiProvider` → `api.openai.com/v1/chat/completions` dengan `response_format: json_object`, `GeminiProvider` → `generativelanguage.googleapis.com/v1beta/...:generateContent` dengan `responseMimeType: application/json`). Prompt canonical enforce **distribusi variabel ikut CONTOH** — 9 baris render mewakili 16 minggu: `week 1:5, 2:5, 3-4:10, 5-7:20, 8:UTS merge, 9-11:30, 12-13:10, 14-15:20, 16:UAS merge` dengan UTS/UAS tanpa bobot di tabel utama (bobot evaluasi di Rubrik), total representasi 16 minggu; `is_merged=true` untuk week 8 UTS label `UJIAN MID SEMESTER` dan week 16 UAS `UJIAN FINAL SEMESTER` (bukan `EVALUASI TENGAH/AKHIR`), `method` `TM 1×(4×50")` / `TM 1×(2×50") + BM+PT (1+1)×(2×60")` + baris `Menyesuaikan perkembangan pandemic COVID-19`, serta CPL 2, CPMK 4 (`R10-R13`), Sub-CPMK 7 dengan taxonomy A2/P3/C2–C4, bahan kajian ~20 bullet `R24`. Validasi Zod: 9 rows (atau expanded 16 logical) yang map ke 16 minggu, weight sum = 100 (variabel), taxonomy allowed; retry 1× jika `weight ≠ 100`. Hasil upsert ke `rps_draft.weeklyPlans/cpl/cpmk/subCpmk/rtmTasks/rubrics`.

### Review & DOCX
*   **FR-05: Review & Edit Tabel 16 Minggu (TanStack Table):** Tabel editable berbasis **TanStack Table v8** dengan inline edit (material, method select TM/BM/PT, experience, assessmentCriteria, weight), badge live `Σ = 100` (hijau=100, merah≠100, shake animation), baris UTS/UAS lock merge dengan `gridSpan` hint dan toast jika coba split. Audit panel inline: `critical` (weight≠100, week count≠16, missing merge) blok Generate DOCX; `warning` (typo `paian`, `Sbu-CPMK-5`, `Mahasiwa`, `Cole, I..`, `DIskusi`; placeholder `Menyesuaikan pandemic COVID-19`) non-blocking dengan saran fix. State tabel via TanStack Table + TanStack Query untuk sync ke DB.
*   **FR-06: Generate DOCX Identik CONTOH & Download:** Tombol `Generate DOCX` memanggil `POST /api/rps/{id}/generate` → server POST JSON (`rps_draft` + global kop dari `api_key`? atau default) ke Python docx service (`http://localhost:8001/generate`) → DOCX bytes dengan 6 `w:sectPr` (portrait cover 12240×15840, landscape weekly/RTM 15840×12240 orient=landscape, portrait rubrics), 4 logical `w:tbl` (44×13 main + 25×7 RTM + 32×100 observasi + assessment), `w:tblGrid`/`w:gridCol` tepat, merge UTS/UAS via `gridSpan`/`vMerge`, `w:trHeight atLeast`, font `Times New Roman sz=18/szCs=18 (9pt)` + style `Normal Pt(9)`, borders `single 4` shading `FFFFFF`, header/footer. Simpan ke local `storage/files/{id}/{hash}.docx`, set `rps_draft.storagePath/fileHash`, return `{ docx_url, file_hash, audit }`. Download via `GET /api/rps/{id}/download?format=docx` streaming dengan `Content-Disposition: {kode}-{nama}-RPS.docx`. Preview HTML tabel (tanpa LibreOffice wajib; LibreOffice opsional untuk PDF).

## Non-Functional Requirements

| Category | Requirement | Metric / Target |
|:---|:---|:---|
| **Performance** | Generate cepat | AI generate < 15s (tergantung provider), DOCX < 3s, TanStack Table render 16 rows < 100ms, LCP < 2.5s |
| **Fidelity** | DOCX identik | 100% match `w:sectPr` 6, `w:tbl` 4 logical, `w:gridCol`, `w:trHeight atLeast`, `sz=18` |
| **Correctness** | Audit gate | Weight 100, 16 minggu, merge UTS/UAS enforced; critical blok DOCX |
| **Security** | BYOK + enkripsi | AES-256-GCM untuk `api_key`, tidak log plaintext, GET mask only, tanpa JWT/BYOK isolasi per-request |
| **Usability** | Input minimal | Draft valid dari 8 field < 5 min; audit feedback < 1s |
| **Maintainability** | Stack simple | ESLint+Prettier, Zod, Prisma single DB, TanStack Query/Table, Python service terisolasi |
| **Reliability** | Persistensi | SQLite/Postgres 1 DB, backup file 30 hari, health `/api/health` & `/health` docx |

## Technology Stack & Rationale

| Component | Technology | Rationale |
|:---|:---|:---|
| Frontend | **React 19 + TanStack Start + TanStack Router + Tailwind CSS v4 + @astryxdesign/core + @stylexjs/stylex + @astryxdesign/theme-neutral + TanStack Query v5 + TanStack Table v8** | **Full Astryx Design System** (`astryx.atmeta.com`) via `https://tanstack.com`: AppShell/TopNav/Stepper/Field/Table/Banner/Badge/ProgressBar/Card/Dialog/Toast via StyleX + Tailwind v4 bridging; React 19 wajib untuk Astryx; **TanStack Start + TanStack Router** (file-based routing, Vite) gantikan Next.js App Router; TanStack Query untuk server state, TanStack Table dibungkus Astryx `Table` untuk 9-row editable grid variabel |
| Backend API | Bun 1.1+ + TanStack Start server routes (Nitro) + Zod + `crypto` AES-GCM | Tanpa JWT/RBAC — semua route public; Zod validasi weight/taxonomy; `crypto` enkripsi key; TanStack Start server functions gantikan Next.js API Routes |
| AI Adaptor | OpenAI API + Gemini API (multi-provider abstraction) | `interface AiProvider { testKey, generate }`; OpenAI `gpt-4o-mini` default, Gemini `gemini-1.5-flash` default; BYOK header per request |
| Docx Engine | Python 3.11 + python-docx + lxml (microservice port 8001) | Dipertahankan untuk fidelity `w:` identik; reuse `skills/rps` |
| Database | **PostgreSQL 16** (atau SQLite untuk MVP 1-file) via **Prisma 5** | Hanya 2 tabel (`api_key`, `rps_draft`); tanpa Redis/S3; `prisma migrate deploy` |
| File Storage | Local filesystem `storage/files/{id}/{hash}.docx` | Tanpa S3; stream via API |
| PDF Preview | Opsional LibreOffice headless; default preview HTML tabel | Pangkas kompleksitas queue |
| Build | Vite + TanStack Start (Nitro) + StyleX compiler (`astryx swizzle`/`xstyle` only) | HMR cepat via Vite; TanStack Start build ke `.output`; StyleX compile hanya jika swizzle/xstyle |
| Theme | `defineTheme({ extends: neutralTheme, color:{accent:['#1E3A5F']}})` + Tailwind v4 bridge (`tailwind-theme.css`) | Academic Navy accent via Astryx token; layer order `reset, theme, base, astryx-base, astryx-theme, components, utilities` di `globals.css` |

## Success Metrics & KPIs

| Metric | KPI | Target |
|:---|:---|:---|
| Input Speed | Waktu dari buka URL ke draft tersimpan | < 5 min |
| AI Correctness | Weight 100 & 16 rows valid di first AI generate | ≥ 90% |
| Fidelity | DOCX audit pass vs CONTOH manifest | 100% sectPr/tblGrid/sz |
| Generation | DOCX p95 | < 3s |
| UX | Audit feedback inline | < 1s |

## Risk Analysis & Mitigation

| Risk | Impact | Mitigasi |
|:---|:---|:---|
| **DOCX fidelity drift** | High | Pin manifest `rps-obe.manifest.json`; snapshot generate→unzip→assert sectPr/tblGrid/sz; CI `rps-audit.py` |
| **AI hallucinate weight≠100** | High | Zod + retry 1× dengan prompt "perbaiki weight ke 100"; blok DOCX jika critical |
| **Key bocor di DB/log** | High | AES-256-GCM, `keyHint` only, never log plaintext, `APP_ENCRYPTION_KEY` di `.env` |
| **Tanpa login → semua orang lihat draft** | Medium | Dokumentasikan sebagai single-tenant demo pribadi; opsi `client_id` cookie follow-up |
| **Provider format beda (OpenAI vs Gemini)** | Medium | Adaptor normalisasi ke `GeneratedJson` yang sama; JSON mode strict per provider |
| **Python service down** | High | Health `/health`, PM2 restart, error actionable + XML dump |

## Constraints & Assumptions

*   **Constraint:** Tanpa login — semua endpoint public; tidak ada JWT/role guard.
*   **Constraint:** API Key wajib BYOK, disimpan terenkripsi di DB via `APP_ENCRYPTION_KEY`; tidak ada hardcode key di server.
*   **Constraint:** Output DOCX harus identik 100% CONTOH (6 sectPr, 4 tbl, atLeast, sz=18); ZIP well-formed.
*   **Constraint:** Stack: **Bun 1.1+ + React 19 + TanStack (Start + Router + Query + Table) + Tailwind v4 + Astryx (@astryxdesign/core + @stylexjs/stylex + theme-neutral via defineTheme)**, Prisma/PostgreSQL (atau SQLite), Python docx; tanpa Node.js, tanpa Next.js, tanpa Redis/BullMQ/S3/Laravel.
*   **Constraint:** UI wajib full Astryx — `AppShell/TopNav` header, `Stepper/Step` 3 langkah, `Field/FieldLabel/TextInput/TextArea/Selector/NumberInput/DateInput/Grid` form 8 field, `Table` wrapper TanStack Table 9 rows, `Banner/Badge/ProgressBar` audit Σ=100; `globals.css` layer order `@layer reset, theme, base, astryx-base, astryx-theme, components, utilities` + `tailwind-theme.css` bridging.
*   **Assumption:** User punya API Key OpenAI/Gemini sendiri.
*   **Assumption:** VPS 1–2GB RAM cukup (tanpa Redis/LibreOffice wajib).

## Out of Scope

v1 simple **TIDAK** termasuk: login/auth/RBAC, approval Kaprodi, admin console, template manifest management, versioning/rollback, S3, Redis queue, LMS, kolaborasi realtime, multi-bahasa, mobile native. AI hanya untuk generate RPS, bukan chat umum.

**Document Version:** 2.0-simple
**Last Updated:** 2026-09-10
**Status:** Ready for Development (Full Astryx + TanStack)
