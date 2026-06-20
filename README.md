# GeoIP Analytics

Веб-сервис аналитики IP-адресов на базе официальных CSV-выгрузок ГРЧЦ РФ GeoIP.

**Репозиторий:** [github.com/finenumbers/geoip](https://github.com/finenumbers/geoip)

Разработано **[Finenumbers](https://finenumbers.com)** — оператор телефонной связи для бизнеса.  
По всем вопросам: **apps@finenumbers.com**

## Стек

- **Backend:** Node.js, TypeScript, Fastify, Drizzle ORM, PostgreSQL
- **Frontend:** React, Vite, TanStack Router/Query/Table, Tailwind CSS
- **Infra:** Docker Compose, NGINX Proxy Manager

## Production за 3 шага

```bash
git clone https://github.com/finenumbers/geoip.git
cd geoip
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

1. Откройте `http://<хост>:8080/admin/setup` — создайте admin
2. Admin → **ГРЧЦ / Import** — укажите creds ЛК, сохраните, «Проверить ГРЧЦ»
3. Admin → **Обзор** → «Импортировать датасет» — дождитесь готовности на Dashboard

Файл `.env` не обязателен. База при первом запуске **пустая** — `/ready` = `not_ready` до успешного import.

## Документация

| Документ | Описание |
|----------|----------|
| [docs/УСТАНОВКА.md](docs/УСТАНОВКА.md) | Docker Compose, Portainer |
| [docs/NGINX-PROXY-MANAGER.md](docs/NGINX-PROXY-MANAGER.md) | HTTPS и Access List через NPM |
| [docs/ADMIN.md](docs/ADMIN.md) | Admin UI и config store |
| [docs/АРХИТЕКТУРА.md](docs/АРХИТЕКТУРА.md) | Архитектура и data plane |
| [docs/FAQ.md](docs/FAQ.md) | Troubleshooting |
| [docs/БЕЗОПАСНОСТЬ.md](docs/БЕЗОПАСНОСТЬ.md) | Секреты и perimeter |
| [docs/РАЗРАБОТКА.md](docs/РАЗРАБОТКА.md) | Локальная разработка |

Portainer: [infra/portainer/README.md](infra/portainer/README.md)

## Публикация на GitHub

```bash
# Проверка перед push
./scripts/check-public-ready.sh
pnpm lint && pnpm test

# Первый push
git remote add origin https://github.com/finenumbers/geoip.git
git push -u origin main
```

## Локальная разработка

```bash
cp .env.example .env
docker compose up postgres -d
pnpm install && pnpm db:migrate
pnpm --filter @geoip/api seed:fixture   # только dev/CI
pnpm dev
```

Подробнее: [docs/РАЗРАБОТКА.md](docs/РАЗРАБОТКА.md)

## Admin

Секреты и настройки (ГРЧЦ, API keys, cron, Google Maps, лимиты) хранятся в volume `config_data` и редактируются в `/admin`. API keys генерируются автоматически при первом boot.

Bootstrap в `.env`: только `DATABASE_URL`, `POSTGRES_*`, `CONFIG_DATA_DIR`, опционально `CONFIG_MASTER_KEY`.

## Безопасность

См. [docs/БЕЗОПАСНОСТЬ.md](docs/БЕЗОПАСНОСТЬ.md). Перед public push: `./scripts/check-public-ready.sh`

## API (основное)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Liveness |
| GET | `/api/v1/ready` | Readiness |
| GET | `/api/v1/public/setup-checklist` | Checklist onboarding (без auth) |
| GET | `/api/v1/dataset/active` | Active dataset |
| POST | `/api/v1/lookup` | IP lookup |
| GET/PUT | `/api/v1/admin/config` | Settings (admin session) |

## Monorepo

```
packages/shared/   # schemas, defaults
packages/api/      # Fastify + workers
packages/web/      # React SPA
docs/              # документация (RU)
```

## Лицензия

[MIT](LICENSE) © Finenumbers
