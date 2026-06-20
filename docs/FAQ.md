# FAQ

## `/ready` возвращает `not_ready` после установки

Ожидаемо на пустой БД. Выполните checklist: Admin → ГРЧЦ → «Импортировать датасет» → дождитесь завершения и refresh MV.

## Import failed

1. Admin → «Проверить ГРЧЦ» — creds и доступ к ЛК
2. Dashboard → последние импорты → детали шага с ошибкой
3. Import worker logs: `docker compose logs import`

Cron **не создаёт** failed run без creds ГРЧЦ — import просто пропускается.

## Карта на IP Lookup не работает

1. Admin → Интеграции → Google Maps Embed API key
2. Ограничьте ключ по referrer вашего домена
3. Ключ подхватывается runtime — пересборка web не нужна

## Admin не открывается / 401

1. Выполните `/admin/setup` при первом запуске
2. Проверьте NPM Access List
3. Cookies: session cookie требует same-site доступ через ваш домен

## API 401 на Dashboard в production

`authEnabled=true` по умолчанию. Nginx должен читать `config_data/proxy.env` и передавать `X-API-Key`. Пересоберите stack если volume `config_data` пустой при старте web.

## Где API keys после fresh install?

Сгенерированы автоматически при первом boot API. Смотрите Admin → API (masked). `proxy.env` обновляется при save.

## Нужен ли `.env` в Docker?

Нет для базового деплоя (CLI или Portainer). Переменные задаются через **Environment variables** stack в Portainer (см. `infra/portainer/stack.env.example`) — отдельный файл `.env` на сервере **не нужен**.

Опционально для CLI: `cp .env.example .env` — compose подставит `${POSTGRES_PASSWORD}` и т.д. при интерполяции.

## Как установить через Portainer?

1. **Stacks → Add stack** → repository или Web editor
2. Compose path: `infra/portainer/stack.compose.yml`
3. Environment variables из `infra/portainer/stack.env.example`
4. Deploy → открыть `:8080/admin/setup`

Подробно: [УСТАНОВКА.md](УСТАНОВКА.md#вариант-2-portainer).

## `seed:fixture` в production?

Нет. Только для локальной разработки и CI.

---

**Репозиторий:** [github.com/finenumbers/geoip](https://github.com/finenumbers/geoip)  
**Finenumbers** · [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
