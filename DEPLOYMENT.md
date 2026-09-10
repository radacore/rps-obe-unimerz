# DEPLOYMENT.md: RPS OBE Generator — Full Astryx + TanStack

## Overview

Deployment ringan untuk **RPS OBE Generator Simple** — **Bun 1.1+ + React 19 + TanStack Start + TanStack Router + Tailwind v4 + Full Astryx (@astryxdesign/core + @stylexjs/stylex + @astryxdesign/theme-neutral + defineTheme Academic Navy) + TanStack Query/Table** + Python docx service + PostgreSQL (atau SQLite) tanpa Redis, tanpa S3, tanpa BullMQ, tanpa Next.js, tanpa LibreOffice wajib. VPS 1–2GB RAM cukup. Satu PM2 app untuk TanStack Start (Vite/Nitro `bun .output/server/index.mjs`) + satu untuk Python docx. Nginx reverse proxy minimal + HTTPS Let's Encrypt. Build via Vite + GitHub Actions SSH. StyleX compile hanya jika `astryx swizzle`/`xstyle` dipakai; otherwise Tailwind v4 bridge.

## Environment Strategy

### Environment Tiers

| Environment | Purpose | Database | Storage | URL Pattern |
|:---|:---|:---|:---|:---|
| **Development** | Local dev | Local PostgreSQL atau SQLite `file:./dev.db` | Local `storage/` | `localhost:3000` |
| **Production** | Live demo skripsi | VPS PostgreSQL atau SQLite file | Local `storage/files` | `rps.example.com` |

Staging opsional (single env cukup untuk skripsi).

### Environment Variables

`.env` per tier (jangan commit). Vars minimal:

```
# App (Bun)
NODE_ENV=production
APP_URL=https://rps.example.com

# Database — pilih salah satu
# Postgres:
DATABASE_URL=postgresql://user:pass@host:5432/rps_simple
# SQLite MVP:
# DATABASE_URL=file:./storage/prod.db

# BYOK Encryption — WAJIB 32-byte hex (64 hex chars)
APP_ENCRYPTION_KEY=<64 hex chars, generate: openssl rand -hex 32>

# Python docx service
DOCX_SERVICE_URL=http://localhost:8001
DOCX_SERVICE_TIMEOUT_MS=10000

# LibreOffice — opsional, hanya jika butuh PDF preview
# LIBREOFFICE_BIN=/usr/bin/soffice
```

Tidak ada `JWT_SECRET`, `JWT_REFRESH_SECRET`, `REDIS_URL`, `AWS_*`, `SMTP_*` — semua dihapus.

Generate encryption key:
```bash
openssl rand -hex 32
# atau bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Infrastructure & Hosting Setup

### VPS Minimal (1–2GB RAM, 1 vCPU, 20GB SSD) — Ubuntu 22.04

#### System Updates

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential
```

#### Bun 1.1+

```bash
curl -fsSL https://bun.sh/install | bash
bun --version
```

#### PostgreSQL 16 — atau SQLite (lebih ringan)

**Opsi A — Postgres:**
```bash
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres createuser rps_user -P
sudo -u postgres createdb rps_simple -O rps_user
```

**Opsi B — SQLite (recommended untuk skripsi 1-file):**
```bash
sudo apt install -y sqlite3
# tidak perlu createuser/createdb; Prisma buat file otomatis
```

#### Python 3.11 + venv

```bash
sudo apt install -y python3 python3-pip python3-venv
python3 -m venv /var/www/rps-obe/venv
/var/www/rps-obe/venv/bin/pip install python-docx lxml fastapi uvicorn
```

#### LibreOffice — Opsional

```bash
# hanya jika butuh PDF preview; skip untuk MVP HTML preview
sudo apt install -y libreoffice-writer
which soffice && soffice --version
```

#### PM2 & Nginx

```bash
sudo bun add -g pm2
sudo apt install -y nginx
sudo systemctl enable nginx
```

### Nginx Configuration — Minimal

Create `/etc/nginx/sites-available/rps`:

```nginx
server {
    listen 80;
    server_name rps.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name rps.example.com;

    ssl_certificate /etc/letsencrypt/live/rps.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rps.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Content-Security-Policy "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval';" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_types text/plain text/css text/xml application/json application/javascript;

    # TanStack Start (Vite/Nitro frontend + server routes) — single process
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static assets cache
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable:
```bash
sudo ln -s /etc/nginx/sites-available/rps /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Tanpa `limit_req_zone login/generate`, tanpa `/api` split — semua ke TanStack Start.

### SSL — Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d rps.example.com
sudo certbot renew --dry-run
```

## Application Deployment

### Repository Setup

```bash
cd /var/www
sudo git clone https://github.com/your-org/rps-obe-generator.git
cd rps-obe-generator
sudo chown -R www-data:www-data .
```

### Install & Prisma

```bash
bun install
# Postgres:
bunx prisma generate && bunx prisma migrate deploy
# SQLite:
# bunx prisma generate && bunx prisma db push

# Seed minimal (1 contoh draft)
bunx prisma db seed

# Build TanStack Start + Full Astryx (Vite/Nitro + StyleX bridge)
# Jika pakai swizzle/xstyle, StyleX compile jalan di build; otherwise Tailwind v4 bridge only
bun run build # → .output (Vite)
```

### PM2 Ecosystem — Ringan (2 apps)

`ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: "rps-web",
      script: "bun",
      args: ".output/server/index.mjs",
      instances: 1,
      env: { NODE_ENV: "production", PORT: 3000 }
    },
    {
      name: "rps-docx",
      script: "/var/www/rps-obe/venv/bin/uvicorn",
      args: "docx_service.app:app --host 0.0.0.0 --port 8001",
      instances: 1
    }
  ]
};
```

Start:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Tanpa `rps-api` (4000), `rps-worker` (BullMQ) — semua API di TanStack Start server routes.

### File Permissions

```bash
sudo chown -R www-data:www-data /var/www/rps-obe-generator
sudo chmod -R 775 /var/www/rps-obe-generator/storage
mkdir -p storage/files storage/logs
```

## CI/CD Pipeline — Minimal

### GitHub Actions (`.github/workflows/deploy.yml`)

```yaml
name: Deploy RPS OBE Simple

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: rps_test
        options: >-
          --health-cmd="pg_isready"
          --health-interval=10s
          --health-retries=5
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 'latest' }
      - uses: actions/setup-python@v4
        with: { python-version: '3.11' }
      - run: pip install python-docx lxml fastapi uvicorn
      - run: bun install
      - run: bunx prisma generate
      - run: bunx prisma migrate deploy
        env: { DATABASE_URL: postgresql://postgres:postgres@localhost:5432/rps_test, APP_ENCRYPTION_KEY: "a".repeat(64) }
      - run: bun test
      - run: bun run build
      - run: python -m pytest tests/docx/ -v
        continue-on-error: true

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/rps-obe-generator
            git pull origin main
            bun install
            bunx prisma generate
            bunx prisma migrate deploy
            bun run build
            pm2 reload ecosystem.config.js
            sudo systemctl reload nginx
```

Checklist:
- [ ] `DATABASE_URL` dan `APP_ENCRYPTION_KEY` set (64 hex chars)
- [ ] `soffice` check hanya jika butuh PDF (opsional)
- [ ] `storage/` writable

## Monitoring & Logging

### Winston — Redact apiKey

```typescript
// lib/logger.ts
import winston from 'winston';
const redact = winston.format((info) => {
  if (info.apiKey) info.apiKey = '***';
  return info;
});
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(redact(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'storage/logs/app.log' }),
    new winston.transports.Console()
  ]
});
```

### Server Monitoring

```bash
# UptimeRobot: monitor https://rps.example.com/api/health
# PM2: pm2 logs rps-web --lines 100
# DB: psql $DATABASE_URL -c "SELECT count(*) FROM rps_draft;"
```

Tanpa Sentry wajib; optional jika mau.

## Caching Strategy — TanStack Query (Tanpa Redis)

| Cache | Key | TTL | Invalidasi |
|:---|:---|:---|:---|
| api-keys mask | `["api-keys"]` | 30s | on `PUT /api/settings/api-keys` |
| rps list | `["rps", {q, page}]` | 30s | on `POST/DELETE /api/rps` |
| rps detail | `["rps", id]` | 30s | on `PUT /api/rps/{id}`, `POST /ai/generate`, `POST /generate` |
| audit | `["rps", id, "audit"]` | 0 (no cache) | manual refetch |

Tidak ada Redis `cache:get:global_settings` — key dan draft langsung dari DB.

## Database Management — Minimal

### Backup

**Postgres:**
```bash
pg_dump $DATABASE_URL | gzip > /backups/rps_$(date +%Y%m%d).sql.gz
# SQLite:
cp storage/prod.db /backups/rps_$(date +%Y%m%d).db
```

Cron mingguan cukup untuk skripsi:
```bash
# 0 2 * * 0 /usr/local/bin/backup-rps-simple.sh
```

### TanStack Data Sync

Tidak ada BullMQ worker — AI dan DOCX sync request, tidak perlu queue backup.

## Rollback Procedures

```bash
git log --oneline | head -20
git revert HEAD
bun install && bun run build
bunx prisma migrate deploy
pm2 reload ecosystem.config.js
```

DB rollback: restore dump `gunzip < /backups/rps_*.sql.gz | psql $DATABASE_URL` atau `cp /backups/*.db storage/prod.db`.

## Security Hardening — Minimal

- HTTPS + HSTS.
- Rate limit in-memory 20/menit untuk `/generate` dan `/ai/generate` per IP (opsional, tanpa Redis).
- Validasi `apiKey` format regex; encrypt at-rest.
- File DOCX `storage/` di luar web root; stream via API.
- UFW: `allow 22,80,443`, `deny 5432` jika Postgres local.

```bash
sudo ufw enable
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## Performance Optimization

- **TanStack Query:** `staleTime 30s`, `gcTime 5m`, optimistic update untuk cell edit.
- **TanStack Table:** Memo columns, no pagination for 16 rows, `getCoreRowModel` only.
- **Prisma:** Single `findUnique` full JSON, no N+1.
- **TanStack Start:** Vite code-splitting + Nitro `.output` + asset hash.
- **DOCX:** <3s p95, AI <15s (provider).

## Disaster Recovery — Simple

| Scenario | RTO | RPO | Action |
|:---|:---|:---|:---|
| DB hilang | 30m | 1 minggu | Restore dump / copy SQLite file |
| VPS mati | 2h | 1 minggu | Provision baru, git pull, restore DB |
| File hilang | 10m | — | Re-generate DOCX dari draft |

## Maintenance

| Task | Frequency | Owner |
|:---|:---|:---|
| Security updates `apt upgrade` | Bulanan | DevOps/Owner |
| Backup verify | Bulanan | Owner |
| SSL renewal | Auto 60d | Certbot |
| `bun audit` | Per deploy | CI |

## Deployment Runbook — Simple

```bash
# Deploy standard
bun test
bun run build
cd /var/www/rps-obe-generator && git pull origin main
bun install && bunx prisma generate && bunx prisma migrate deploy && bun run build
pm2 reload ecosystem.config.js
curl -s https://rps.example.com/api/health | jq
pm2 logs rps-web --lines 50
```

## Assumptions & Constraints

- Stack fixed: **Bun 1.1+ + React 19 + TanStack Start/Router/Query/Table (tanstack.com) + Tailwind v4 + Full Astryx (@astryxdesign/core + StyleX + theme-neutral + defineTheme Academic Navy + tailwind-theme.css)**, Prisma 5 + Postgres/SQLite, Python docx; tanpa Node.js, tanpa Next.js, tanpa Redis/S3/BullMQ/LibreOffice wajib.
- Week 16 fixed, weight 100 enforced Zod (UI via Astryx `Badge`/`ProgressBar`/`Banner`).
- DOCX ZIP/XML well-formed; 6 `w:sectPr` manifest pinned.
- `APP_ENCRYPTION_KEY` 64 hex chars wajib; app fail start jika missing.
- `globals.css` layers `reset, theme, base, astryx-base, astryx-theme, components, utilities` + `tailwind-theme.css` bridge wajib; React 19 required untuk Astryx.

**Document Version:** 2.0-simple
**Last Updated:** 2026-09-10
**Status:** Ready for Development (Full Astryx + TanStack)
