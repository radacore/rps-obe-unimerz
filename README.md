# RPS OBE Generator — Simple (BYOK) — Bun + TanStack + Python DOCX

Tanpa login. 3 langkah: Identitas → Generate AI 9 baris (16 minggu, Σ=100) → DOCX. Full Astryx-ish UI (Tailwind v4 + Academic Navy #1E3A5F), TanStack Router/Query/Table, Hono on Bun, Prisma 5 SQLite, Python docx service (FastAPI) + JS fallback (`docx` npm).

## Quick start (Bun 1.1+)

```bash
bun install
cp .env.example .env        # isi APP_ENCRYPTION_KEY: openssl rand -hex 32
bunx prisma db push         # buat prisma/dev.db (2 tabel)
bun run db:seed  # optional — seed IW21ASK1541

# terminal 1 — Hono API (port 3001, ekspor {port, fetch} untuk Bun.serve)
bun run server.ts

# terminal 2 — Python DOCX service (port 8001)
python3 -m pip install -r docx_service/requirements.txt
python3 -m uvicorn docx_service.app:app --host 127.0.0.1 --port 8001 --reload

# terminal 3 — Vite (port 3000, proxy /api → 3001)
bun run dev:web
# atau all-in-one:
bun run dev:all
```

Open http://localhost:3000  — Drafts → Buat Draft → `/rps/:id` → Settings → Generate 9 baris → Generate DOCX → Download.

## Stack

- **Bun 1.1+ + Hono** (`server.ts` ekspor `{port, fetch}` untuk `Bun.serve`) — bukan `node`/`createServer`.
- **Vite 8 + React 19 + TanStack Router/Query/Table 8** — `src/routes`, `src/components/WeeklyTable.tsx` (9 rows canonical).
- **Tailwind v4** (`src/index.css` + `src/styles/tailwind-theme.css`) Academic Navy `#1E3A5F`.
- **Prisma 5 SQLite** `DATABASE_URL=file:./prisma/dev.db` — 2 tabel `api_key` + `rps_draft`.
- **AES-256-GCM** `src/lib/crypto.ts` (`node:crypto`, `APP_ENCRYPTION_KEY` 64 hex).
- **Python** `docx_service/app.py` (FastAPI + python-docx) + **JS fallback** `src/lib/docx.ts` (`docx` npm) supaya `GET /api/rps/:id/download` selalu `PK` meski Python mati.

## API (public, tanpa JWT/BYOK)

- `GET /api/health`, `GET/PUT /api/settings/api-keys`, `POST /api/settings/api-keys/test`
- `GET /api/rps`, `POST /api/rps`, `GET/PUT/DELETE /api/rps/:id`, `POST /api/rps/:id/audit`, `POST /api/rps/:id/ai/generate`, `POST /api/rps/:id/generate`, `GET /api/rps/:id/download`

Weekly canonical: `R35 1:5, R36 2:5, R37 3,4:10, R38 5,6,7:20 (pandemic hook), R39 8 UTS merge 0, R40 9,10,11:30, R41 12,13:10, R42 14,15:20, R43 16 UAS merge 0` Σ non-merge 100.

## Verify

```bash
bunx tsc -b
bun run build
bunx oxlint
curl -sf http://localhost:3001/api/health
```

## Deploy (VPS 1–2GB)

`bun install && bunx prisma db push --accept-data-loss && bun run build` + PM2 `ecosystem.config.js` Bun + uvicorn + Nginx `/api` → 3001, `/` → 3000.
