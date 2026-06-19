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

For restart policies, healthchecks, log rotation, and API auth on ops endpoints:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

With `API_AUTH_ENABLED=true`, nginx injects `X-API-Key` from `IMPORT_API_KEY` into proxied `/api/` requests so the Dashboard keeps working without exposing the key in the browser bundle.

TLS example: [infra/nginx/tls.example.conf](infra/nginx/tls.example.conf)

### PostgreSQL backup

```bash
chmod +x scripts/backup-postgres.sh
DATABASE_URL=postgresql://geoip:geoip@localhost:5433/geoip ./scripts/backup-postgres.sh
```

Backups are written to `./backups/` by default (`BACKUP_DIR` overrides the path).

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

В Docker после сборки:

```bash
docker compose exec import-worker node dist/scripts/trigger-import.js
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
| GET | `/api/v1/metrics/prometheus` | Prometheus text metrics (same auth as `/metrics`) |

## Структура monorepo

```
packages/
  shared/   # Zod schemas, types
  api/      # Fastify backend + import worker
  web/      # React SPA
fixtures/   # Sample CSV for tests
```
