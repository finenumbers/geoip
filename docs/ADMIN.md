# Администрирование

Все операционные настройки хранятся локально в Docker volume `config_data` (`/data/geoip/config/`):

- `settings.json` — обычные параметры
- `secrets.enc` — зашифрованные секреты (AES-256-GCM)
- `proxy.env` — API key для nginx → API (обновляется при сохранении External IP Lookup key)

Доступ к `/admin` — отдельный логин (session cookie) **поверх** NPM Access List.

## Первичная настройка

1. `/admin/setup` — учётная запись администратора
2. `/admin/setup-api-key` — **обязательно** сгенерировать API-ключ External IP Lookup (скопируйте до сохранения)
3. Admin → ГРЧЦ — учётные данные ЛК ГРЧЦ
4. Admin → Обзор — импорт датасета

## Обзор

- Checklist готовности системы
- «Проверить ГРЧЦ» — probe ЛК без запуска import
- «Импортировать датасет» — ручная постановка импорта в очередь
- Подсказки о полях, требующих перезапуска сервисов

## Общие

| Поле | Описание |
|------|----------|
| Часовой пояс отображения | IANA timezone (default `Europe/Moscow`). Все даты/время в UI и на дашборде показываются в этом поясе |

## ГРЧЦ / Import

**Обязательно.** Личные учётные данные ЛК ГРЧЦ — вводит каждый оператор.

| Поле | Описание |
|------|----------|
| Email / Пароль | Доступ к личному кабинету GeoIP на сайте ГРЧЦ |
| Base URL | URL ЛК (default уже задан) |
| Расписание import | **Фиксировано:** ежедневно **10:00 Europe/Moscow** (не редактируется) |
| ZIP cache / Skip unchanged / Staging snapshot | Оптимизации import (defaults включены) |

После save: «Проверить ГРЧЦ» → «Импортировать датасет» на Обзоре.

Cron **не запускает** import, пока не указаны creds ГРЧЦ.

## API и безопасность

**Production defaults:**

- `authEnabled=true` — table, lookup, exports требуют `X-API-Key`
- **External IP Lookup key** задаётся на шаге `/admin/setup-api-key` (не генерируется автоматически вместе с admin)
- Import API key генерируется системой для внутренних операций
- Rate limits — project defaults

Nginx читает `proxy.env` и подставляет External IP Lookup key в proxied `/api/` — SPA работает без ключа в браузере.

## Admin доступ

Смена логина/пароля администратора. Требуется текущий пароль.

## Export

Директория, retention, лимиты строк — defaults уже заполнены.

## Производительность

Pool size, statement timeout, ASN map batch/workers — defaults для типичного деплоя.

## Интеграции

**Google Maps (опционально).** Ключ Maps Embed API — в Google Cloud Console, ограничение по HTTP referrer. Подхватывается runtime без переборки web.

## Логирование

Уровень логов и access log.

## Инфраструктура

Postgres, compose, NPM — настраиваются вне Admin store (Portainer / правка compose).

## Восстановление данных

Автобэкап PostgreSQL **не используется**. При проблеме с данными выполните повторный import датасета из ГРЧЦ.

## Что не хранится в Admin

- `POSTGRES_*` — заданы в `docker-compose*.yml` (можно заменить при деплое)
- `CONFIG_MASTER_KEY` — env / compose (пусто = автогенерация в `meta.json` на volume)

См. [БЕЗОПАСНОСТЬ.md](БЕЗОПАСНОСТЬ.md).

---

**Finenumbers** · [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
