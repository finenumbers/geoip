# Администрирование

Все операционные настройки хранятся локально в Docker volume `config_data` (`/data/geoip/config/`):

- `settings.json` — обычные параметры
- `secrets.enc` — зашифрованные секреты (AES-256-GCM)
- `proxy.env` — API key для nginx → API (обновляется автоматически)

Доступ к `/admin` — отдельный логин (session cookie) **поверх** NPM Access List.

## Первичная настройка

1. Откройте `/admin/setup`
2. Задайте логин и пароль администратора
3. После сохранения вы попадёте в Admin → Обзор с checklist

## Обзор

- Checklist готовности системы
- «Проверить ГРЧЦ» — probe ЛК без запуска import
- «Импортировать датасет» — ручная постановка импорта в очередь
- Подсказки о полях, требующих перезапуска сервисов

## ГРЧЦ / Import

**Обязательно.** Личные учётные данные ЛК ГРЧЦ — вводит каждый оператор.

| Поле | Описание |
|------|----------|
| Email / Пароль | Доступ к личному кабинету GeoIP на сайте ГРЧЦ |
| Base URL | URL ЛК (default уже задан) |
| Время import | Cron в формате UI (по умолчанию 10:00) |
| Timezone | `Europe/Moscow` |
| ZIP cache / Skip unchanged / Staging snapshot | Оптимизации import (defaults включены) |

После save: «Проверить ГРЧЦ» → «Импортировать датасет» на Обзоре.

Cron **не запускает** import, пока не указаны creds ГРЧЦ.

## API и безопасность

**Defaults при первом boot (production):**

- `authEnabled=true` — table, lookup, exports требуют `X-API-Key`
- API keys **генерируются автоматически** (не placeholder)
- Rate limits — project defaults

Nginx читает `proxy.env` и подставляет ключ в proxied `/api/` — SPA работает без ключа в браузере.

## Admin доступ

Смена логина/пароля администратора. Требуется текущий пароль.

## Export

Директория, retention, лимиты строк — defaults уже заполнены.

## Производительность

Pool size, statement timeout, ASN map batch/workers — defaults для типичного деплоя.

## Интеграции

**Google Maps (опционально).** Ключ Maps Embed API — в Google Cloud Console, ограничение по HTTP referrer. Подхватывается runtime без пересборки web.

## Логирование и backup

Уровень логов, access log, интервал и retention бэкапов Postgres.

## Инфраструктура

Postgres, compose, NPM — настраиваются вне Admin store (Portainer / `.env` bootstrap).

## Что не хранится в Admin

- `DATABASE_URL`, `POSTGRES_*` — bootstrap / compose
- `CONFIG_MASTER_KEY` — env / Portainer (ключ шифрования volume)

См. [БЕЗОПАСНОСТЬ.md](БЕЗОПАСНОСТЬ.md).

---

**Finenumbers** · [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
