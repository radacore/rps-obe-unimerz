# REQUIREMENTS.md: RPS OBE Generator — Simple BYOK

## 1. Functional Requirements

### 1.1. Input & Draft (Tanpa Login)

**FR-01: Input Field Minimal (8–10 Field Teks Penting)**
Sistem WAJIB menyediakan satu halaman form stepper 3 langkah tanpa login dengan field minimal berikut:
*   Step 1 Identitas: `course_name` (string, required), `course_code` (string, required, canonical `IW21ASK1541` — cover sync `R03`, bukan `IW25ASK105431`/`17505R0203`), `course_cluster` (string, required, e.g. Keperawatan), `sks_total`/`sks_theory`/`sks_practice` (int, required, canonical `T=3 P=1 total 4`, validasi `sks_total = sks_theory + sks_practice`), `semester` (string, enum I–VIII + Ganjil/Genap, CONTOH `I`), `preparation_date` (date ISO, required, e.g. `2025-06-28`), `lecturers` (array min 1, tiap item `{ name, nidn, role: pengembang|koordinator_mk|ketua_prodi|anggota }`, require 1 `koordinator_mk`; mapping: `R04-R05` Otorisasi 3 role + `R29` Dosen Pengampu = semua names join; contoh 5 dosen `Ns. Sri Wahyuni` koordinator, `Ns. Iqwan Syarif` ketua_prodi). Kop universitas hardcode `Universitas Megarezky | Fakultas Keperawatan dan Kebidanan | Program Studi S1 Keperawatan dan Pendidikan Profesi Ners` (tanpa `global_settings` editable).
*   Step 2 Deskripsi & Hint: `description` / bahan kajian singkat (textarea 3–5 baris, required, e.g. "HTML, CSS, REST API, Vercel..."), `cpl_hint` (textarea, optional, baris-baris), `cpmk_hint` (textarea, optional).
*   Validasi inline via Zod + TanStack Query mutation; error mapping ke field.
*   Tanpa autentikasi — semua route public.

**FR-02: Draft Persistence (Simpan di DB)**
Sistem WAJIB menyimpan draft ke database tanpa versioning:
*   Setiap save (auto-save debounce 500ms + tombol Simpan) melakukan upsert ke `rps_draft` dengan `status: draft`.
*   List draft di `/` dengan kolom: `course_name`, `course_code`, `semester`, `updated_at`, `status`; pagination 15, search `q` by name/code (<500ms untuk ≤1000 draft), aksi Lanjutkan Edit / Hapus / Download.
*   Hapus draft via `DELETE /api/rps/{id}` tanpa soft-delete.
*   Tidak ada `RPS_VERSION`, `ACTIVITY_LOG`, atau approval — last-write-wins.

### 1.2. API Key BYOK Multi-Provider

**FR-03: Kelola API Key Multi-Provider (DB + Enkripsi)**
Sistem WAJIB mengelola API Key BYOK per provider dengan enkripsi at-rest:
*   Provider didukung: `openai` (key `sk-...` / `sk-proj-...`), `gemini` (`AIza...`), extensible `claude` (`sk-ant-...`). UI `/settings` menampilkan card per provider dengan input `password` + eye-toggle, placeholder, link cara dapat key (platform.openai.com / aistudio.google.com), tombol **Test Key**, badge `Valid/Invalid`.
*   Penyimpanan: tabel `api_key` dengan `encrypted_key` (AES-256-GCM, `APP_ENCRYPTION_KEY` 32-byte hex di `.env`), `key_hint` (4 char terakhir), `is_active` boolean. `PUT /api/settings/api-keys { provider, apiKey }` encrypt + upsert (`@@unique([provider])` untuk single-tenant global). `GET /api/settings/api-keys` hanya return `[{ provider, keyHint: "****abcd", isActive, updatedAt }]` — tidak pernah plaintext.
*   Penggunaan: decrypt ephemeral per request di `POST /api/rps/{id}/ai/generate` dan `POST /api/settings/api-keys/test`; tidak pernah log plaintext (Winston redact).
*   Validasi format key per provider (regex) dan `test` via adaptor (OpenAI `GET /v1/models`, Gemini `GET /v1beta/models`); return `{ valid, modelCount? }`.

### 1.3. AI Full 16 Minggu

**FR-04: Generate AI Full 16 Minggu + CPL/CPMK/Sub-CPMK**
Sistem WAJIB menghasilkan full 16 minggu + capaian via AI multi-provider:
*   Trigger: tombol `Generate 16 Minggu dengan AI` pada Step 3 (pilih `provider` select + `model` select: OpenAI `gpt-4o-mini`/`gpt-4o` default `gpt-4o-mini`, Gemini `gemini-1.5-flash`/`gemini-1.5-pro` default `gemini-1.5-flash`). Request `POST /api/rps/{id}/ai/generate { provider?, model?, promptOverride? }`.
*   Server flow: ambil `rps_draft` + decrypt `api_key` untuk provider → panggil adaptor `AiProvider.generate(prompt)` dengan prompt canonical yang enforce: **9 baris render mewakili 16 minggu variabel CONTOH** — `R35 week1:5, R36 week2:5, R37 week3-4:10, R38 week5-7:20, R39 UTS merge (week 8), R40 week9-11:30, R41 week12-13:10, R42 week14-15:20, R43 UAS merge (week16)` sum 100 (variabel, bukan 7×5+15), `is_merged=true` label `UJIAN MID SEMESTER`/`UJIAN FINAL SEMESTER`, `method` `TM 1×(4×50")`/`TM 1×(2×50") + BM+PT (1+1)×(2×60")` + hook `Menyesuaikan perkembangan pandemic COVID-19`, `Daring/Luring` split, CPL 2 (`R07-R08`), CPMK 4 (`R10-R13`), Sub-CPMK 7 (`R15-R21`) dengan `taxonomy` ∈ {A2,P3,C2,C3,C4}, bahan kajian ~20 bullet `R24`, RTM 1 tugas Mind Map `4x50' 5%`, rubrik observation 8 + assessment 6 baris.
*   Provider adaptor: `OpenAiProvider` via `POST https://api.openai.com/v1/chat/completions` dengan `response_format: {type:"json_object"}`; `GeminiProvider` via `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` dengan `generationConfig.responseMimeType: "application/json"`. Kedua dinormalisasi ke `GeneratedJson` yang sama dan divalidasi Zod.
*   Validasi: Zod schema `weeklyPlans.length=9` (merged weeks) mewakili 16 minggu, `weight sum=100` variabel `5+5+10+20+30+10+20=100` + 2 UTS/UAS merge, `is_merged` untuk 8/16, `taxonomy` allowed. Jika `weight≠100` → retry 1× dengan prompt perbaikan. Simpan `aiProvider/aiModel` ke `rps_draft` dan upsert `cpl/cpmk/subCpmk/weeklyPlans/rtmTasks/rubrics` JSON. Return `{ weeklyPlans, cpl, cpmk, audit: { passed, issues } }`. Catatan: ekspansi 16 logical rows opsional di FE, canonical render tetap 9 rows dengan `week: "3, 4"`/`"5,6,7"` seperti CONTOH.
*   State frontend: TanStack Query `useMutation` untuk generate, `useQuery` untuk draft, invalidasi `["rps", id]` on success.
*   Error: 422 jika key belum diset / invalid, 502 jika provider error, 429 jika rate limit provider.

### 1.4. Review, Edit & Export

**FR-05: Review & Edit Tabel 16 Minggu (TanStack Table)**
Sistem WAJIB menyediakan tabel review & edit berbasis TanStack Table:
*   Render **9 rows (mewakili 16 minggu)** via **TanStack Table v8** (headless) + **TanStack Query v5** untuk server state. Kolom: week (read-only badge, `1`/`2`/`3, 4`/`5,6,7`/`8`/`9,10,11`/`12,13`/`14,15`/`16`; 8/16 merged badge), material (textarea inline), method (select `TM 1×(4×50")`/`TM 1×(2×50")` + hook `Menyesuaikan pandemic COVID-19`/`BM+PT (1+1)×(2×60")`), experience (textarea, Daring vs Luring split), assessmentCriteria (textarea), weight (variabel `5/10/20/30` per CONTOH, bukan uniform 5).
*   Live badge `Σ = 100` (hijau Success `#15803D` jika 100, merah Error `#DC2626` + shake jika ≠100) update debounced 300ms.
*   Baris UTS/UAS (`is_merged=true`) render single merged cell spanning full width dengan label evaluasi + `Bobot 15%`; lock — toast "UTS/UAS harus tetap merge" jika coba split.
*   Inline edit: cell double-click → input → blur/commit → `PUT /api/rps/{id}` (TanStack Mutation, optimistic update).
*   Audit panel: `critical` (weight≠100, week count≠16, missing merge 8/16, sz drift jika ada DOCX) blok tombol Generate DOCX (disabled + tooltip list issues); `warning` (typo `paian`, `Sbu-CPMK-5`, `Mahasiwa`, `Cole, I..`, `DIskusi`; placeholder `Menyesuaikan pandemic COVID-19`) non-blocking dengan link "Fix" jump ke cell.

**FR-06: Generate DOCX Identik CONTOH & Download**
Sistem WAJIB menghasilkan DOCX identik dan menyediakan download:
*   Tombol `Generate DOCX` → `POST /api/rps/{id}/generate` (public, tanpa auth). Server fetch `rps_draft` full + POST JSON `{ rps_draft, global_settings default }` ke Python docx service `POST http://localhost:8001/generate` (timeout 10s). Service build DOCX dengan 6 `w:sectPr` (portrait cover 12240×15840, landscape weekly/RTM 15840×12240 orient=landscape, portrait rubrics), 4 logical `w:tbl` (44×13 / 25×7 / 32×100 + assessment), `w:tblGrid`/`w:gridCol` tepat, merge UTS/UAS `gridSpan`/`vMerge`, `w:trHeight atLeast`, font `Times New Roman sz=18/szCs=18 (9pt)` + style `Normal Pt(9)`, borders `single 4` shading `FFFFFF`, header/footer default.
*   Simpan ke local `storage/files/{id}/{hash}.docx`, hitung SHA256, set `rps_draft.storagePath/fileHash/status=generated`. Return `201 { docx_url: "/api/rps/{id}/download", file_hash, audit }`. Generation <3s p95.
*   Download `GET /api/rps/{id}/download?format=docx` streaming binary dengan `Content-Disposition: attachment; filename="{kode}-{nama}-RPS.docx"` (fallback `RPS-{id}.docx`). Rate limit 20/menit per IP via in-memory atau tanpa Redis (opsional).
*   Preview: HTML preview tabel (bukan PDF wajib) dengan orientation badge portrait/landscape; LibreOffice `soffice` opsional jika butuh PDF (tidak required untuk MVP).

## 2. Non-Functional Requirements

| Category | Requirement | Measurable Target |
|:---|:---|:---|
| Performance | AI + DOCX latency | AI <15s p95 (provider), DOCX <3s p95, TanStack Table 16 rows <100ms, LCP <2.5s |
| Fidelity | DOCX structural match | 100% `w:sectPr` 6, `w:tbl` 4 logical, `w:gridCol`, `w:trHeight atLeast`, `sz=18` |
| Correctness | Audit gate | Weight 100, 16 weeks, merged UTS/UAS enforced; critical blok DOCX |
| Security | BYOK + enkripsi | AES-256-GCM, GET mask only, no plaintext log, no JWT |
| Usability | Simple flow | Input 8 field <5 min, feedback <1s |
| Maintainability | Quality gates | ESLint/Prettier, Zod, TanStack Query/Table, >70% backend coverage, Prisma migrate |
| Reliability | Persistensi simple | Single DB, backup file 30d, health endpoints |

## 3. Technical Constraints

*   Sistem WAJIB tanpa login/auth — semua endpoint public; tidak ada JWT/role guard.
*   Sistem WAJIB multi-provider `openai`+`gemini` via adaptor `AiProvider` dengan BYOK decrypt ephemeral.
*   Sistem WAJIB enkripsi `api_key.encrypted_key` via `APP_ENCRYPTION_KEY` (AES-256-GCM); GET hanya `keyHint`.
*   Sistem WAJIB generate DOCX identik 100% CONTOH (6 sectPr, 4 tbl, merges, sz=18, atLeast) via Python service terisolasi `http://localhost:8001`.
*   Sistem WAJIB **Full Astryx** — semua UI pakai `@astryxdesign/core`: `AppShell/TopNav`, `Stepper/Step`, `Field/TextInput/TextArea/Selector/NumberInput/DateInput/Grid`, **Astryx `Table` (wrapper TanStack Table v8)** untuk 9-row grid, `Banner/Badge/ProgressBar` audit, `Card/Pagination/EmptyState/Dialog/Toast`; `defineTheme({extends: neutralTheme, color:{accent:['#1E3A5F']}})` + `tailwind-theme.css` + `globals.css` layers `@layer reset, theme, base, astryx-base, astryx-theme, components, utilities`; React 19 wajib.
*   Sistem WAJIB pakai **TanStack Query v5** untuk server state dan **TanStack Table v8 via Astryx `Table`** untuk 16-week grid.
*   Sistem WAJIB simpan draft di DB (`rps_draft`) bukan localStorage; localStorage hanya untuk cache UI opsional.
*   Database WAJIB Prisma 5 + PostgreSQL 16 (atau SQLite file untuk MVP) dengan 2 tabel; tidak ada Redis/S3/BullMQ.
*   File storage WAJIB local `storage/files/{id}/{hash}.docx`; tidak ada S3 driver.
*   Tech stack fixed: **Bun 1.1+ + React 19 + TanStack Start + TanStack Router + TanStack Query v5 + TanStack Table v8 (tanstack.com) + Tailwind v4 + Full Astryx (@astryxdesign/core + @stylexjs/stylex + @astryxdesign/theme-neutral + @astryxdesign/cli) + defineTheme Academic Navy + tailwind-theme.css bridge (layers `reset, theme, base, astryx-base, astryx-theme, components, utilities`)** + Vite, Python 3.11 python-docx+lxml; tanpa Node.js, tanpa Next.js.

## 4. Assumptions

*   User memiliki API Key OpenAI/Gemini sendiri dan bersedia menempelkannya di `/settings`.
*   Single-tenant global (semua pengunjung sharing DB) acceptable untuk demo skripsi pribadi; isolasi `client_id` cookie adalah follow-up.
*   AI provider JSON mode stabil; prompt canonical cukup untuk weight 100 konsisten (dengan retry).
*   CONTOH RPS.docx tersedia sebagai source of truth untuk manifest (6 sectPr, 4 tbl).
*   VPS minimal 1GB RAM cukup tanpa Redis/LibreOffice wajib.

**Document Version:** 2.0-simple
**Last Updated:** 2026-09-10
**Status:** Ready for Development (Full Astryx + TanStack)
