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

## Импорт данных

```bash
curl -X POST http://localhost:3000/api/v1/imports \
  -H "X-API-Key: change-me-in-production" \
  -H "Content-Type: application/json" \
  -d '{"triggeredBy":"manual"}'
```

Import worker автоматически подхватывает queued jobs и выполняет cron по `IMPORT_CRON_CRON`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Liveness |
| GET | `/api/v1/ready` | Readiness |
| GET | `/api/v1/dataset/active` | Active dataset |
| GET | `/api/v1/imports` | Import history |
| POST | `/api/v1/imports` | Trigger import (API key) |
| POST | `/api/v1/lookup` | IP lookup |
| GET | `/api/v1/table/city` | City analytics table |
| GET | `/api/v1/table/country` | Country analytics table |
| POST | `/api/v1/exports/table` | CSV export (API key) |
| GET | `/api/v1/metrics` | Metrics |

## Структура monorepo

```
packages/
  shared/   # Zod schemas, types
  api/      # Fastify backend + import worker
  web/      # React SPA
fixtures/   # Sample CSV for tests
```
