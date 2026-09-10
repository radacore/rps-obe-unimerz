# ROADMAP.md: RPS OBE Generator — Full Astryx + TanStack

## Phased Delivery Plan — Simple (1 Developer, 1–2 Minggu)

| Phase | Duration | Goals | Key Deliverables |
|:---|:---|:---|:---|
| **Phase 1: Foundation, Theme & Settings (BYOK)** | 3–4 hari | Setup React 19 + TanStack Start/Router + Tailwind v4 + Full Astryx + 2-tabel Prisma, encrypt key, UI settings Astryx. | **React 19 + TanStack Start/Router/Query/Table (tanstack.com) + Tailwind v4 + `@astryxdesign/core` + `@stylexjs/stylex` + `@astryxdesign/theme-neutral` + `defineTheme` Academic Navy** (`bunx astryx init --all`, `tailwind-theme.css` bridge, `globals.css` layers `reset, theme, base, astryx-base, astryx-theme, components, utilities`) + Vite setup, Prisma 5 + Postgres/SQLite (2 tabel), `APP_ENCRYPTION_KEY` AES-GCM, `/settings` Astryx `Card`/`Field` OpenAI/Gemini dengan Test Key via adaptor, list draft `/` dengan `Card`/`Pagination`/`EmptyState` + search. |
| **Phase 2: Input Minimal + AI Full 16 Minggu** | 3–4 hari | Astryx `Stepper`/`Field` 3 langkah, adaptor multi-provider, generate AI + Astryx `Table`. | FR-01/02 Astryx `Stepper`/`Step` + `Field`/`TextInput`/`Selector`/`NumberInput`/`DateInput`/`Grid` 8 field (canonical IW21ASK1541, SKS T=3 P=1, 1 Koordinator MK), FR-03 BYOK encrypt, FR-04 `OpenAiProvider`/`GeminiProvider` (JSON mode) + prompt canonical 9 rows variabel R35-R43 (5+5+10+20+30+10+20=100), Astryx `Table` (wrapper TanStack) 9 rows (16 minggu) live `Badge`/`ProgressBar` Σ=100 + merged UTS/UAS UJIAN MID/FINAL lock + `Banner` audit. |
| **Phase 3: DOCX Identik + Polish & Deploy** | 2–3 hari | Integrate Python docx service, audit typo, deploy VPS ringan. | FR-06 Python :8001 generate 6 `w:sectPr`/4 `w:tbl`/`sz=18`, download streaming, audit `Banner status:error/warning` + typo scan, Nginx + PM2 (2 apps), CI test + `rps-audit.py` snapshot, go-live demo. |

Total: **8–11 hari** untuk 1 developer (+1 hari setup Full Astryx theme vs 7–10 hybrid). Tanpa Phase 4/5 enterprise (approval, versioning, S3, analytics).

**Timeline Disclaimer:** Estimasi untuk 1 developer skripsi full-time. Jika 2 developer, Phase 2 bisa paralel (AI adaptor + Table). Feedback dosen pembimbing dapat geser ±2 hari. CONTOH RPS.docx diasumsikan tersedia hari 1 untuk manifest.

---

## MVP Feature List — Simple

### P0: Must Have (Tanpa ini tidak bisa demo skripsi)

| Feature | Reference | Notes |
|:---|:---|:---| 
| Input Field Minimal (8–10 field) | FR-01 | Stepper 3 langkah, SKS=T+P, Pengampu Utama required, tanpa login. |
| Draft Persistence (DB) | FR-02 | `rps_draft` JSON, list/search/pagination TanStack Query. |
| Kelola API Key Multi-Provider (DB encrypt) | FR-03 | Cards OpenAI/Gemini, mask `****abcd`, Test Key, AES-GCM. |
| Generate AI Full 16 Minggu | FR-04 | `OpenAiProvider` (gpt-4o-mini) + `GeminiProvider` (gemini-1.5-flash), prompt 9 rows variabel (5+5+10+20+30+10+20=100), retry weight. |
| Review & Edit TanStack Table 16 Minggu | FR-05 | TanStack Table v8 inline edit, live Σ badge, merged lock, audit panel. |
| Generate DOCX Identik CONTOH | FR-06 | 6 sectPr, 4 tbl 44×13/25×7/32×100, `atLeast`, `sz=18`, python-docx. |
| Download DOCX | FR-06 | Stream `Content-Disposition: {kode}-{nama}-RPS.docx`. |
| Audit & Typo Scan | FR-05/06 | Weight 100, 16 rows, merged, `paian`/placeholder warning. |
| Preview HTML | FR-06 | Orientation badge portrait/landscape, tanpa LibreOffice wajib. |
| Tech: TanStack Query/Table, Prisma, Python docx | NFR | Stack fixed simple. |

### P1: Should Have (1 minggu post-MVP, optional untuk nilai plus)

| Feature | Notes |
|:---|:---| 
| LibreOffice PDF preview (opsional) | `soffice` polling 202 queued, page_count badge. |
| SQLite fallback (1-file DB) | `DATABASE_URL=file:./dev.db` untuk tanpa Postgres. |
| In-memory rate limit 20/menit | Untuk `/ai/generate` & `/generate` per IP. |
| Winston redact `apiKey` | Tidak log plaintext. |
| DOCX snapshot CI | `rps-audit.py` assert sectPr 6/tblGrid/sz. |

### P2: Nice to Have (Future, tidak untuk skripsi MVP)

| Feature | Notes |
|:---|:---| 
| `client_id` cookie untuk multi-tenant anonim | Isolasi draft/key per browser. |
| Claude adaptor (`sk-ant-...`) | Extensible provider ketiga. |
| Versioning & diff/rollback | Append-only `RPS_VERSION` (deferred). |
| Approval Kaprodi / Admin console | Deferred enterprise. |
| S3 / Redis / BullMQ | Tidak untuk simple. |
| LMS integration, kolaborasi realtime | Out of scope. |
| Public API scoped tokens | Future. |

---

## Milestones — Simple

| Milestone | Phase | Target | Deliverables |
|:---|:---|:---|:---|
| **Project Setup + Full Astryx (TanStack)** | 1 | Hari 1–2 | React 19 + TanStack Start/Router + Tailwind v4 + Full Astryx (`defineTheme` Academic Navy + `tailwind-theme.css` + layers) + Vite, Prisma 2 tabel migrate, `.env` + `APP_ENCRYPTION_KEY`. |
| **Settings BYOK Ready** | 1 | Hari 2–3 | `/settings` cards OpenAI/Gemini, encrypt/decrypt AES-GCM, Test Key adaptor (OpenAI/Gemini), TanStack `["api-keys"]` caching, list draft `/`. |
| **Stepper & AI Adaptor** | 2 | Hari 4–5 | Stepper 3 langkah 8 field + auto-save debounce, `AiProvider` interface + 2 impl, prompt canonical, `POST /ai/generate` Zod validate + retry. |
| **TanStack Table Complete** | 2 | Hari 6–7 | 9 rows (16 minggu) grid `useReactTable`, inline edit optimistic, live Σ=100 badge + shake, merged UTS/UAS lock, audit panel typo. |
| **DOCX Fidelity Proven** | 3 | Hari 8 | Python :8001 generate IW21ASK1541 Ilmu Biomedik Dasar; `rps-audit.py` pass 6 sectPr/4 tbl/sz=18; HTML preview badge. |
| **Deploy & Go-Live** | 3 | Hari 9–10 | VPS 1GB, Nginx, PM2 2 apps, `prisma migrate deploy`, `bun run build`, `/api/health` ok, demo download. |

---

## Dependencies

### External Dependencies

| Dependency | Purpose | Required | Notes |
|:---|:---|:---|:---|
| **VPS 1–2GB/1vCPU/20GB Ubuntu 22.04** | Hosting TanStack Start (Vite/Nitro) + Python | Required | 1GB cukup (tanpa Redis/LibreOffice wajib). Root SSH + A record. |
| **Domain & DNS** | `rps.example.com` | Required | Client own DNS → VPS IP; Let's Encrypt. |
| **PostgreSQL 16 atau SQLite file** | DB 2 tabel | Required | Local Postgres atau `file:./storage/prod.db` untuk MVP. |
| **Python 3.11 + python-docx + lxml** | DOCX engine | Required | Venv `/var/www/rps-obe/venv` :8001. |
| **OpenAI &/atau Gemini API Key (BYOK)** | AI generate | Required | User tempel di `/settings`; tidak butuh SMTP. |
| **CONTOH RPS.docx** | Source of truth fidelity | Required | 6 sectPr/4 tbl manifest pin. |
| **API Keys Provider** | Test key endpoint | Required | `api.openai.com/v1/models`, `generativelanguage.googleapis.com`. |

Tidak ada Redis, S3, SMTP, LibreOffice wajib, SSL extra beyond Let's Encrypt.

### Internal Dependencies

| Dependency | Owner | Deadline | Notes |
|:---|:---|:---|:---|
| **CONTOH RPS.docx + manifest** | Dosen/Owner | Hari 1 | Pin `rps-obe.manifest.json` untuk DOCX test. |
| **Prompt canonical + few-shot IW21ASK1541** | Backend | Hari 4 | Weight 9 rows variabel R35-R43 template untuk AI. |
| **Design tokens (Navy)** | Frontend | Hari 1 | Tailwind config + TanStack Table styling. |
| **API spec simple (6 endpoints)** | Backend | Hari 2 | `API.md` 6 endpoints consumed by TanStack Query. |
| **TanStack Query/Table setup** | Frontend | Hari 2 | `QueryClient`, `useReactTable` headless, DevTools. |
| **Prisma schema 2 tabel** | Backend | Hari 1 | `DATABASE.md` approved. |

---

## Risks & Mitigation — Simple

| Risk | Impact | Probability | Mitigasi |
|:---|:---|:---|:---|
| **AI weight hallucination ≠100** | High | Medium | Zod + retry 1× prompt repair; blok DOCX jika critical. |
| **DOCX fidelity drift** | High | Medium | Pin manifest; CI snapshot generate→unzip→assert 6/4/sz=18. |
| **Key bocor** | High | Low | AES-GCM, mask only, no log plaintext. |
| **Provider format beda** | Medium | Medium | Adaptor normalisasi + JSON mode strict. |
| **Python service down** | High | Low | `GET /health`, PM2 restart, actionable error. |
| **Tanpa login data terlihat semua orang** | Medium | High | Dokumen single-tenant demo pribadi; follow-up `client_id` cookie. |
| **Scope creep enterprise** | Medium | High | MoSCoW P0 only; P1/P2 deferred; weekly check dosen. |

---

## Technical Milestones & Deliverables — Simple

### Phase 1: Foundation, DB & Settings (Hari 1–3)

**Hari 1–2:**
- `bun create vite@latest` + `bun add @tanstack/react-start @tanstack/react-router @tanstack/react-query @tanstack/react-table @astryxdesign/core @stylexjs/stylex @astryxdesign/theme-neutral @astryxdesign/cli zod` + React 19 + Tailwind v4
- `bunx astryx init --all` → `tailwind-theme.css` bridge + `lib/theme.ts` `defineTheme({extends: neutralTheme, color:{accent:['#1E3A5F']}})` + `globals.css` layers `reset, theme, base, astryx-base, astryx-theme, components, utilities`; `src/routes/__root.tsx` + `src/routes/index.tsx` (TanStack Router)
- `prisma init` 2 tabel (`api_key`, `rps_draft`) + `prisma generate` + `migrate dev` atau `db push` SQLite
- `APP_ENCRYPTION_KEY` generate + `crypto` helper

**Hari 3:**
- `/settings` page: 2 Astryx `Card` provider + `Field`/`TextInput` + `PUT/GET /api/settings/api-keys` encrypt/mask + `POST /test` adaptor
- `GET/POST /api/rps` + list `/` dengan TanStack Query `["rps"]` search + Astryx `Card`/`Pagination`/`EmptyState`
- `AppShell` + `TopNav` + `Stepper` shell (3 steps) + TanStack Query client + DevTools

---

### Phase 2: Input Minimal + AI Full 16 Minggu (Hari 4–7)

**Hari 4–5:**
- Astryx `Stepper`/`Step` Step 1 Identitas (`Field`/`TextInput`/`Selector`/`NumberInput`/`DateInput`/`Grid` 8 field, Zod `sks_total=T+P`, Koordinator MK) + Step 2 `TextArea` deskripsi
- `AiProvider` interface + `OpenAiProvider`/`GeminiProvider` + prompt canonical 16 rows + `POST /api/rps/{id}/ai/generate` Zod validate + retry
- `PUT /api/rps/{id}` patch + auto-save 500ms

**Hari 6–7:**
- Astryx `Table` (wrapper TanStack) 9 rows (16 minggu): `useReactTable` + `createColumnHelper`, inline cell editors `TextInput`/`Selector` via `meta.updateData` optimistic
- Live `Badge`/`ProgressBar` Σ (hijau/merah shake) + merged row lock + `Banner status:error/warning` audit panel typo `paian`
- Action bar Generate DOCX (disabled if critical via `Banner`) + preview HTML `Badge`

---

### Phase 3: DOCX Identik + Polish & Deploy (Hari 8–10)

**Hari 8:**
- Python FastAPI `/generate` integrate (reuse `skills/rps/scripts/rps-generate.py`); `POST /api/rps/{id}/generate` proxy + hash + `storage/files`
- `GET /api/rps/{id}/download` streaming + `Content-Disposition`
- Audit final + `rps-audit.py` snapshot harness

**Hari 9–10:**
- Polish: loading spinner AI 15s, toast, empty states, responsive table scroll, Winston redact, health `/api/health`
- Deploy: VPS, Nginx, PM2 2 apps, `prisma migrate deploy`, `bun run build`, SSL, UptimeRobot, demo IW21ASK1541 download

---

## Success Criteria & Go-Live Checklist — Simple

### Functional Completeness
- [ ] 8 field input → draft tersimpan <5 min tanpa login
- [ ] BYOK encrypt + Test Key valid untuk OpenAI & Gemini
- [ ] AI generate 16 rows + CPL/CPMK valid, weight 100 ≥90% first try
- [ ] TanStack Table 9 rows (16 minggu) editable, live Σ variabel 5/10/20/30, merged UJIAN MID/FINAL lock, audit typo
- [ ] Generate DOCX + download `Content-Disposition` ok

### Fidelity & Performance
- [ ] DOCX audit 100%: `w:sectPr` 6, `w:tbl` 4 logical 44×13/25×7/32×100, `w:gridCol`, `w:trHeight atLeast`, `sz=18`
- [ ] p95 DOCX <3s, LCP <2.5s, TanStack Table 16 rows <100ms
- [ ] HTML preview orientation badges ok (PDF opsional)

### Testing & Security
- [ ] Zod validation weight variabel sum 100 (9 rows)/taxonomy/SKS T=3 P=1
- [ ] Key AES-GCM encrypt, GET mask only, no plaintext log
- [ ] HTTPS + HSTS, file `storage/` outside webroot

### Deployment
- [ ] VPS 1GB + Nginx + PM2 (2 apps) + Postgres/SQLite + Python :8001
- [ ] `APP_ENCRYPTION_KEY` 64 hex set, `DATABASE_URL` set
- [ ] `pm2 logs` clean, `/api/health` 200, demo download verified

---

## Post-Launch Roadmap — Simple (Optional)

### Follow-up 1: Multi-tenant Anonim (Minggu 3)
- `client_id` cookie httpOnly + `@@unique([clientId, provider])` + filter `where clientId`.

### Follow-up 2: Enhancements (Minggu 4)
- Claude adaptor, SQLite→Postgres migrasi jika butuh, in-memory rate limit, Winston redact verify, LibreOffice PDF optional.

---

## Resource Allocation — Simple

| Role | Allocation | Responsibilities |
|:---|:---|:---|
| **Full-Stack (1 orang)** | 100% | TanStack Start/Router + React + Astryx + Tailwind, Prisma 2 tabel, AI adaptor OpenAI/Gemini, Python docx proxy, audit, deploy VPS. |
| **Dosen Pembimbing** | 10% | Prompt review, fidelity check CONTOH, demo feedback. |
| **QA (owner)** | 20% | Test AI weight 100, DOCX snapshot, download verify. |

---

## Communication & Governance — Simple

- **Daily async:** Update progress di chat.
- **Dosen check-in:** Demo tiap 3 hari di VPS staging (weight 100, DOCX fidelity).
- **Change control:** P0 only; P1/P2 di backlog; scope enterprise ditolak untuk MVP.
- **Docs:** 9 files di `prd-rps-obe-generator/` adalah source of truth.

---

## Assumptions & Constraints — Simple

**Assumptions:**
- User punya OpenAI/Gemini key sendiri.
- CONTOH RPS.docx tersedia hari 1 untuk manifest pin.
- Single-tenant global acceptable untuk demo pribadi.
- AI JSON mode stabil dengan retry.

**Constraints:**
- Stack fixed: **Bun 1.1+ + React 19 + TanStack Start/Router/Query/Table (tanstack.com) + Tailwind v4 + Full Astryx (@astryxdesign/core + StyleX + theme-neutral + defineTheme)**, Python python-docx+lxml, Prisma + Postgres/SQLite. Tanpa Node.js, tanpa Next.js, tanpa Redis/S3/BullMQ/Laravel/PHP.
- 9 rows variabel R35-R43, merged 8 UJIAN MID + 16 UJIAN FINAL, weight variabel sum 100 enforced Zod + audit blok DOCX (via Astryx `Banner`/`Badge`).
- DOCX ZIP/XML well-formed; 6 `w:sectPr` pinned.
- `APP_ENCRYPTION_KEY` 32-byte wajib; file `storage/files` local; `globals.css` layers `reset, theme, base, astryx-base, astryx-theme, components, utilities` + `tailwind-theme.css` wajib.

**Document Version:** 2.0-simple
**Last Updated:** 2026-09-10
**Status:** Ready for Development (Full Astryx + TanStack, 1–2 Minggu)
