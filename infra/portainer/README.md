# Установка через Portainer

Production stack GeoIP Analytics на одном Docker-хосте. Использует те же compose-файлы, что и CLI-установка.

**Репозиторий:** [github.com/finenumbers/geoip](https://github.com/finenumbers/geoip)

Полное руководство: [docs/УСТАНОВКА.md](../../docs/УСТАНОВКА.md).

## Файлы stack

| Файл | Назначение |
|------|------------|
| [`stack.compose.yml`](stack.compose.yml) | Точка входа для Portainer (`include` корневых compose) |
| [`stack.env.example`](stack.env.example) | Шаблон переменных окружения |

Корневые файлы (подключаются автоматически):

- [`docker-compose.yml`](../../docker-compose.yml) — базовые сервисы
- [`docker-compose.prod.yml`](../../docker-compose.prod.yml) — prod overlay (только `:8080`, backup, limits)

## Быстрый старт в Portainer

### 1. Создать stack

**Portainer → Stacks → Add stack**

- **Name:** `geoip`
- **Repository** (рекомендуется): `https://github.com/finenumbers/geoip`, branch `main`, compose path `infra/portainer/stack.compose.yml`
- **Или Web editor:** вставьте содержимое `stack.compose.yml` (репозиторий должен быть на хосте по пути `infra/portainer/`)

### 2. Environment variables

Скопируйте из [`stack.env.example`](stack.env.example) в **Stack → Environment variables** (файл `.env` на хосте не требуется):

```env
POSTGRES_USER=geoip
POSTGRES_PASSWORD=ваш-сильный-пароль
POSTGRES_DB=geoip
CONFIG_MASTER_KEY=<64 hex-символа>
BACKUP_INTERVAL_SECONDS=86400
```

- `CONFIG_MASTER_KEY` — сгенерируйте один раз, сохраните backup (шифрует `config_data`).
- После смены `POSTGRES_PASSWORD` обновите [`../pgbouncer/userlist.txt`](../pgbouncer/userlist.txt) и redeploy.

### 3. Deploy

Дождитесь статуса `running` у всех контейнеров. Первый запуск API — до ~2 мин (migrations).

### 4. Admin setup

1. `http://<docker-host>:8080/admin/setup` (или через NPM: `https://<домен>/admin/setup`)
2. Создайте admin login/password
3. **Admin → ГРЧЦ / Import** — creds ЛК, «Проверить ГРЧЦ»
4. **Admin → Обзор** → «Импортировать датасет»
5. (Опционально) **Admin → Интеграции** — Google Maps key

**Не используйте** `seed:fixture` в production.

## NGINX Proxy Manager

См. [docs/NGINX-PROXY-MANAGER.md](../../docs/NGINX-PROXY-MANAGER.md).

- Proxy Host → `http://<docker-host>:8080` (схема **HTTP**)
- SSL + Access List только на NPM
- API (`3000`) и Postgres не публикуются на хост

## Обновление stack

1. Pull изменений (git или Portainer webhook)
2. **Stacks → geoip → Update the stack**
3. Volumes (`config_data`, `pg_data`) сохраняются

## Проверки после деплоя

```bash
curl -s http://localhost:8080/api/v1/health
curl -s http://localhost:8080/api/v1/public/setup-checklist
curl -s http://localhost:8080/api/v1/ready
```

В Portainer: **Containers → geoip_import → Logs** — import worker и cron.

## Troubleshooting

| Симптом | Действие |
|---------|----------|
| API не healthy | Logs `geoip_api`, дождитесь migrations |
| `not_ready` на Dashboard | Ожидаемо до первого import — см. checklist |
| 401 на API в prod | Проверьте volume `config_data` и `proxy.env` у `geoip_web` |
| PgBouncer auth failed | Синхронизируйте `userlist.txt` с `POSTGRES_PASSWORD` |

См. [docs/FAQ.md](../../docs/FAQ.md).

---

**Finenumbers** · [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
