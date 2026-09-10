# USER_FLOW.md: RPS OBE Generator — Full Astryx + TanStack

## Overview

Dokumen ini merinci alur pengguna untuk **RPS OBE Generator Simple** — tool tanpa login dengan **Full Astryx Design System (@astryxdesign/core + StyleX + theme-neutral + defineTheme Academic Navy) + TanStack Query/Table** untuk state dan grid 9 rows/16 minggu, **BYOK multi-provider** (OpenAI + Gemini) untuk generate full 16 minggu, dan **Python docx service** untuk DOCX identik CONTOH (6 `w:sectPr`, 4 `w:tbl` 44×13/25×7/32×100, `w:trHeight atLeast`, `Times New Roman sz=18`). Shell `AppShell/TopNav`, form `Field/Stepper`, grid via **Astryx `Table` (wrapper TanStack Table v8)**. Hanya satu aktor (User anonim), 3 flow utama. Semua endpoint public tanpa JWT.

---

## Flow 1: Setup API Key BYOK Multi-Provider (FR-03)

### Trigger
User pertama kali membuka tool atau key belum diset / ingin ganti provider.

### Pre-conditions
- App deploy, `/settings` accessible, tanpa login.
- `APP_ENCRYPTION_KEY` ter-set di server.

### Post-conditions
- `api_key` tersimpan terenkripsi AES-256-GCM per provider dengan `key_hint` mask.
- Test Key valid; generate AI siap dipakai.

### Flow Table

| No | Actor | Action/Step | System Response | Alternative/Error Path |
|:---|:---|:---|:---|:---|
| 1 | User | Navigasi ke `/settings` | TanStack Start + Astryx `AppShell/TopNav` render 2 `Card`: OpenAI (`sk-...`) dan Gemini (`AIza...`) dengan mask `****abcd` via `Badge`, `Field` + `TextInput type=password` + eye-toggle, link "Cara dapat key", `Button` Test Key & Save. TanStack Query `GET /api/settings/api-keys` (key `["api-keys"]`). | Jika `GET` kosong → `EmptyState` + CTA "Tempel API Key". |
| 2 | User | Pilih provider card, paste key `sk-proj-...` | Frontend mask preview `sk-****abcd` client-side; validasi regex format (openai `^sk-`, gemini `^AIza`); tombol Save enable jika format ok. | Format salah → inline error "Format key tidak valid untuk OpenAI". |
| 3 | User | Klik Test Key | Frontend `useMutation` POST `/api/settings/api-keys/test {provider}`. | 422 no key set → toast. |
| 4 | System | Test via adaptor | Server decrypt ephemeral → `OpenAiProvider.testKey` GET `https://api.openai.com/v1/models` atau `GeminiProvider` GET `v1beta/models`; return `{valid, models}`. | 502 invalid key (401) → badge merah Invalid + toast. |
| 5 | System | Return | `200 {valid:true, models:[...]}` → badge hijau Valid + dropdown models enabled. | 502/429 → toast "Provider error, coba lagi". |
| 6 | User | Klik Save | `useMutation` PUT `/api/settings/api-keys {provider, apiKey}`. | 422 validation → errors map to field. |
| 7 | System | Encrypt & store | AES-GCM encrypt dengan `APP_ENCRYPTION_KEY`, upsert `api_key` dengan `keyHint` last4, return `200 {keyHint}`. TanStack invalidasi `["api-keys"]`. | 500 encryption key missing → error "Server misconfigured". |
| 8 | User | Lihat mask | Card update `sk-****abcd` + timestamp; key plaintext tidak pernah terlihat lagi. | — |

---

## Flow 2: Input Minimal & Generate AI Full 16 Minggu (FR-01, FR-02, FR-04, FR-05)

### Trigger
User membuat RPS baru dari field minimal dan memakai AI untuk isi full 16 minggu.

### Pre-conditions
- API Key valid untuk provider pilihan (Flow 1).
- `/` atau `/rps/new` accessible.

### Post-conditions
- `rps_draft` tersimpan dengan `weeklyPlans` 16 rows, `cpl/cpmk/subCpmk`, `weight sum=100`, `is_merged` week 8/16, editable di TanStack Table.

### Flow Table

| No | Actor | Action/Step | System Response | Alternative/Error Path |
|:---|:---|:---|:---|:---|
| 1 | User | Buka `/` → klik Buat RPS Baru | TanStack Start + Astryx `AppShell/TopNav` render `/rps/new` via `Stepper`/`Step` 3 langkah (Identitas → Deskripsi → AI Generate) + `ProgressBar`. | Jika ada draft list (`Card`/`Pagination`/`EmptyState`), klik Lanjutkan Edit → `/rps/{id}`. |
| 2 | User | Isi Step 1 Identitas: course name `Ilmu Biomedik Dasar`, code canonical `IW21ASK1541`, cluster `Keperawatan`, SKS `T=3 P=1` total 4 (CONTOH R03), semester `I`, prep date `2025-06-28`, lecturers repeater hybrid 4 roles (Pengembang/Koordinator MK/Ketua PRODI/Anggota) — require 1 Koordinator MK (default `Ns. Sri Wahyuni` + `Ns. Iqwan Syarif`), kop Megarezky hardcode tampil readonly | Astryx `Field`/`TextInput`/`Selector`/`NumberInput`/`DateInput` dalam `Grid`; TanStack `useMutation` POST `/api/rps` on Next; Zod `sks_total=T+P`, no Koordinator → `Banner status:error`. Auto-save debounce 500ms `PUT /api/rps/{id}`. | SKS mismatch → `Field` error "Total harus = T+P"; no Koordinator → `Banner` "Minimal 1 Koordinator MK". |
| 3 | User | Isi Step 2 Deskripsi MK: `TextArea` "Mata kuliah ini membahas..." + opsional cpl_hint/cpmk_hint | Same auto-save; TanStack Query `["rps", id]` cache optimistic. | Kosong → next allow, AI pakai default prompt. |
| 4 | User | Buka Step 3 AI Generate: pilih Provider `Selector` (OpenAI/Gemini) + Model `Selector` (gpt-4o-mini / gemini-1.5-flash default) | Model list dari `["api-keys"]` test atau static; `Badge variant:success` "Key valid". | Key belum set → `Banner status:warning` "Set API Key di /settings" + Generate disabled. |
| 5 | User | Klik Generate 16 Minggu dengan AI | `useMutation` POST `/api/rps/{id}/ai/generate {provider, model}` via Astryx `Button` + spinner 15s + `Toast`. | 422 no key → redirect /settings; 429 → `Toast` retry. |
| 6 | System | AI generate | Server decrypt key → adaptor `generate` prompt 9 rows variabel `R35-R43 (1:5, 2:5, 3,4:10, 5,6,7:20, 8:UTS merge, 9,10,11:30, 12,13:10, 14,15:20, 16:UAS merge =100)` + CPL2 CPMK4 Sub-CPMK7 → Zod validate 9 rows weight 100 → retry 1× → upsert `rps_draft` + `aiProvider/aiModel`. | 502 → `Banner status:error` + `Toast` "Coba model lain". |
| 7 | System | Return | `200 {weeklyPlans 9 rows, cpl 2, cpmk 4, audit:{passed, issues}}`; invalidasi `["rps", id]` → auto-scroll ke Review `Table`. | Jika critical → `Badge variant:danger` + block DOCX. |
| 8 | User | Review Astryx `Table` 9 rows (16 minggu) | Astryx `Table` (wrapper `useReactTable`): kolom week (`1`/`2`/`3, 4`/…/`16`), material `TextArea`, method `Selector` `TM 1×(4×50")` + hook pandemic, experience Daring/Luring, criteria, weight 5/10/20/30; footer live `Σ=100` via `Badge variant:success/danger` + `ProgressBar` + shake; row 8 `UJIAN MID SEMESTER` + row 16 `UJIAN FINAL SEMESTER` merged lock. `Banner status:error/warning` panel dengan Fix links. | Weight 95 → `Badge variant:danger` + `Banner` + Generate DOCX disabled + `Toast` list. |
| 9 | User | Edit inline cell (double-click → `TextInput`/`Selector` → blur commit) | `useMutation` PUT `/api/rps/{id} {weeklyPlans}` optimistic; debounce 300ms weight calc; `Toast` feedback. | Week 8/16 split → `Toast` "UTS/UAS harus tetap merge" + revert. |
| 10 | System | Persist | Update `rps_draft` JSON, return `{weight_total}`. | 422 taxonomy invalid → inline error. |

---

## Flow 3: Generate DOCX Identik & Download (FR-06)

### Trigger
User sudah review 16 minggu valid (weight 100) dan ingin DOCX final.

### Pre-conditions
- `rps_draft` audit `passed:true` (no critical).
- Python docx service healthy `GET http://localhost:8001/health`.

### Post-conditions
- DOCX 6 `w:sectPr`, 4 `w:tbl`, `sz=18`, merge UTS/UAS tersimpan di `storage/files/{id}/{hash}.docx` dengan `fileHash`.
- User download via `Content-Disposition`.

### Flow Table

| No | Actor | Action/Step | System Response | Alternative/Error Path |
|:---|:---|:---|:---|:---|
| 1 | User | Klik Generate DOCX (enable hanya jika audit passed) | Frontend `useMutation` POST `/api/rps/{id}/generate` dengan spinner <3s. | Jika audit critical → button disabled + tooltip list issues. |
| 2 | System | Audit final | Re-run Zod audit (weight, 16 rows, merged 8/16, typo scan `paian`, placeholder). | Critical → 422 `audit critical` + issues. |
| 3 | System | Call Python docx | `POST http://localhost:8001/generate` dengan `rps_draft` JSON + default kop; build DOCX via python-docx/lxml. | 502 docx service error → `500 {message: Generation failed}` + log XML dump. |
| 4 | System | Store & hash | Write `storage/files/{id}/{hash}.docx`, sha256, update `rps_draft.fileHash/storagePath/status=generated`. | Hash sama → skip write, reuse. |
| 5 | System | Return | `201 {docx_url:/api/rps/{id}/download, file_hash, audit}`. TanStack invalidasi `["rps", id]`. | — |
| 6 | User | Lihat preview HTML | Table preview dengan orientation badge portrait/landscape + page count estimasi; bukan PDF wajib. | LibreOffice opsional: jika ada → PDF preview via `soffice` polling (202 queued). |
| 7 | User | Klik Download DOCX | `GET /api/rps/{id}/download` streaming binary. | 404 file hilang → toast + prompt re-generate. |
| 8 | System | Stream | `Content-Disposition: attachment; filename="IW21ASK1541-Ilmu Biomedik Dasar-RPS.docx"` + `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`. | 410 expired (manual delete) → re-generate. |

---

## Ringkasan Alur Simple

**Tanpa login — 3 flow saja:**
- **Setup Key (Flow 1)** → `/settings` BYOK multi-provider, encrypt AES-GCM, Test Key via adaptor.
- **Input & AI (Flow 2)** → Stepper 3 langkah (8 field) + Generate AI full 16 minggu (TanStack Query mutation) → Review/edit di TanStack Table 16 rows dengan live weight 100 + audit typo.
- **Ekspor (Flow 3)** → Generate DOCX identik 6 sectPr/4 tbl/sz=18 via Python :8001 → Download streaming.

Tanpa dashboard role, tanpa approval, tanpa admin console. Semua state via TanStack Query/Table dengan invalidasi dan optimistic update.

**Document Version:** 2.0-simple
**Last Updated:** 2026-09-10
**Status:** Ready for Development (Full Astryx + TanStack)
