# GeoIP Analytics

Внутренний веб-сервис аналитики IP-адресов на базе официальных CSV-выгрузок ГРЧЦ РФ GeoIP.

## Стек

- **Backend:** Node.js, TypeScript, Fastify, Drizzle ORM, PostgreSQL
- **Frontend:** React, Vite, TanStack Router/Query/Table/Virtual, Tailwind CSS
- **Infra:** Docker Compose

## Быстрый старт

```bash
cp .env.example .env
# Заполните GEOIP_LK_EMAIL, GEOIP_LK_PASSWORD, IMPORT_API_KEY

docker compose up postgres -d
pnpm install
pnpm db:migrate
pnpm --filter @geoip/api seed:fixture
pnpm dev
```

- API: http://localhost:3000
- Web: http://localhost:5173

## Docker (production-like)

```bash
docker compose up --build
```

- Web: http://localhost:8080
- API: http://localhost:3000

### Production overlay

For restart policies, resource limits, `/ready`-based healthchecks, automated backups, and API auth on data-plane endpoints:

```bash
cp .env.example .env
# Set strong POSTGRES_PASSWORD, IMPORT_API_KEY/API_KEY
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

Production behavior:

- Postgres, PgBouncer, and API are **not** published on the host (only web on `:8080`).
- `API_AUTH_ENABLED=true` by default — table, lookup, exports, and dashboard ops require `X-API-Key`. Nginx injects the key for proxied `/api/` requests so the SPA works without exposing the key in the browser bundle.
- **Perimeter auth:** use Access List in NGINX Proxy Manager (no built-in web login).
- Update `infra/pgbouncer/userlist.txt` when changing `POSTGRES_PASSWORD`.
- Export CSV files live in `EXPORT_DIR` (`/tmp/geoip-exports` in Docker); **api** and **export** services share the `export_data` volume.
- API `/api/v1/ready` returns **503** until status is `ready` (degraded/not_ready during import or MV refresh).
- `postgres-backup` sidecar runs `scripts/backup-postgres.sh` on `BACKUP_INTERVAL_SECONDS` (default daily).
- **HTTPS:** terminate TLS in NGINX Proxy Manager; proxy to `http://<host>:8080` (scheme `http`, port `8080` only).

#### NGINX Proxy Manager checklist

1. **Proxy Host:** domain → `http://<server-ip>:8080`, scheme **HTTP** (no SSL on the container).
2. **SSL:** Let's Encrypt (or your cert) on the NPM host only.
3. **Access List:** restrict who can open the UI (replaces built-in basic auth).
4. **Secrets in `.env`:** strong `POSTGRES_PASSWORD`, `IMPORT_API_KEY` / `API_KEY`; set `API_AUTH_ENABLED=true`.
5. **PgBouncer:** after password change, update `infra/pgbouncer/userlist.txt` and restart the stack.
6. **Do not publish** API (`3000`) or Postgres on the host — prod overlay exposes web `:8080` only.

### PostgreSQL backup

Manual backup (dev):

```bash
chmod +x scripts/backup-postgres.sh
DATABASE_URL=postgresql://geoip:geoip@localhost:5433/geoip ./scripts/backup-postgres.sh
```

Restore:

```bash
chmod +x scripts/restore-postgres.sh
DATABASE_URL=postgresql://geoip:geoip@localhost:5433/geoip ./scripts/restore-postgres.sh backups/geoip_YYYYMMDD_HHMMSS.sql.gz
```

Backups are written to `./backups/` by default (`BACKUP_DIR` overrides the path). The production overlay stores backups in the `pg_backups` Docker volume.

### Карта на IP Lookup

В `.env` задайте `VITE_GOOGLE_MAPS_API_KEY` (Google Cloud → **Maps Embed API**, ограничьте ключ по HTTP referrer). Пересоберите web:

```bash
docker compose up --build web
```

Без ключа блок «Карта» покажет подсказку; координаты берутся из секции City lookup.

## Импорт данных

**Cron (автоматически):** по умолчанию `IMPORT_CRON_CRON=0 20 * * *` и `IMPORT_CRON_TZ=Europe/Moscow` (ежедневно в 20:00 МСК). Import worker ставит job в очередь по расписанию.

**Ручной запуск (ops / агент):**

```bash
pnpm --filter @geoip/api import:trigger
```

Проверка доступа к ЛК ГРЧЦ (ops):

```bash
pnpm --filter @geoip/api probe:lk
```

В Docker после сборки:

```bash
docker compose exec import node dist/scripts/trigger-import.js
```

Worker подхватывает queued jobs по `IMPORT_POLL_INTERVAL_MS`. В БД хранятся только **10 последних** import runs (история на Dashboard).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Liveness |
| GET | `/api/v1/ready` | Readiness |
| GET | `/api/v1/dataset/active` | Active dataset + volumes |
| GET | `/api/v1/imports` | Last 10 import runs (max) |
| GET | `/api/v1/imports/:id` | Import run with steps |
| POST | `/api/v1/lookup` | IP lookup |
| GET | `/api/v1/table/city` | City analytics table |
| GET | `/api/v1/table/country` | Country analytics table |
| POST | `/api/v1/exports/table` | CSV export (API key required) |
| GET | `/api/v1/exports/:id` | Export status (API key required) |
| GET | `/api/v1/exports/:id/download` | Export download (API key required) |
| GET | `/api/v1/metrics` | Metrics (API key if `API_AUTH_ENABLED=true`) |

## Структура monorepo

```
packages/
  shared/   # Zod schemas, types
  api/      # Fastify backend + import worker
  web/      # React SPA
fixtures/   # Sample CSV for tests
```
