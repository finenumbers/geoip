# Периметр и HTTPS

NGINX Proxy Manager (NPM), HTTPS, Access List и внешний доступ к IP Lookup API.

**Репозиторий:** [github.com/finenumbers/geoip](https://github.com/finenumbers/geoip)

Предварительно: stack развёрнут — [РАЗВЁРТЫВАНИЕ.md](РАЗВЁРТЫВАНИЕ.md), onboarding пройден — [БЫСТРЫЙ-СТАРТ.md](БЫСТРЫЙ-СТАРТ.md).

---

## Содержание

1. [Схема трафика](#схема-трафика)
2. [Proxy Host в NPM](#proxy-host-в-npm)
3. [SSL (Let's Encrypt)](#ssl-lets-encrypt)
4. [Access List](#access-list)
5. [External IP Lookup API](#external-ip-lookup-api)
6. [Google Maps API key](#google-maps-api-key)
7. [CORS](#cors)
8. [Чеклист безопасного production](#чеклист-безопасного-production)
9. [Troubleshooting NPM](#troubleshooting-npm)

---

## Схема трафика

Production overlay публикует **только порт 8080** (`geoip_web`). Postgres и API (`3000`) **не** торчат наружу.

```
Internet → NPM (443/TLS) → host:8080 → geoip_web (nginx)
                                              ├─ / → SPA
                                              ├─ /api/v1/lookup → api (+ client or internal X-API-Key)
                                              └─ /api/* → geoip_api:3000 (+ injected X-API-Key)
```

| Слой | Механизм |
|------|----------|
| Perimeter | NPM HTTPS + Access List |
| Admin UI | Session cookie (поверх NPM) |
| Data API | `X-API-Key` (production: `authEnabled=true`) |
| SPA (internal) | nginx injects key из `config_data/proxy.env` |

---

## Proxy Host в NPM

### Предварительные условия

1. GeoIP stack running, `geoip_web` на порту **8080**
2. NPM имеет сетевой доступ к Docker-хосту
3. DNS A/AAAA домена → сервер с NPM

### Шаги

1. NPM → **Hosts → Proxy Hosts → Add Proxy Host**
2. **Domain Names:** `geoip.example.com`
3. **Scheme:** `http`
4. **Forward Hostname / IP:**
   - NPM на том же хосте: `127.0.0.1`
   - NPM в Docker на той же сети: IP хоста или имя контейнера
5. **Forward Port:** `8080`
6. **Block Common Exploits:** включить
7. **Websockets Support:** выключить (не требуется)

Сохраните без SSL — сначала проверьте HTTP:

```bash
curl -sI http://geoip.example.com/api/v1/health
# HTTP/1.1 200
```

Браузер: `http://geoip.example.com/admin/login`

---

## SSL (Let's Encrypt)

1. Proxy Host → вкладка **SSL**
2. **SSL Certificate:** Request a new SSL Certificate
3. **Force SSL:** включить
4. **HTTP/2 Support:** включить
5. **HSTS Enabled:** после успешной проверки
6. Email для Let's Encrypt — рабочий
7. Save

Сертификат хранится в NPM, не в контейнере GeoIP.

---

## Access List

Ограничьте доступ к UI и `/admin`:

1. NPM → **Access Lists → Add Access List**
2. **Name:** `geoip-internal`
3. **Authorization:** разрешённые IP (офис, VPN) и/или HTTP Username/Password
4. Save

5. Proxy Host → **Access** → выберите `geoip-internal`

**Вариант:** только `/admin` за Access List через Custom location — остальной сайт публичный.

Admin login (session cookie) работает **поверх** NPM Access List — это второй слой защиты.

---

## External IP Lookup API

Внешние интеграции вызывают lookup **без** доступа к UI, с собственным API-ключом.

### Ключ

Создаётся на обязательном шаге `/admin/setup-api-key` или позже: Admin → **API и безопасность → API-ключ External IP Lookup**.

### Endpoint

```http
POST https://geoip.example.com/api/v1/lookup
X-API-Key: <ваш API key>
Content-Type: application/json

{"ip":"8.8.8.8","include":["city","country","asn"]}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `ip` | string | IPv4 или IPv6 (обязательно) |
| `include` | string[] | Опционально: `city`, `country`, `asn`. Без поля — все секции |

### Ответ

JSON: `ip`, `city`, `country`, `asn`, `meta` (`datasetDate`, `queriedAt`).

### Коды ошибок

| HTTP | Причина |
|------|---------|
| 401 | Нет или неверный `X-API-Key` |
| 400 | Невалидный IP |
| 422 | Ошибка валидации тела |
| 429 | Rate limit (Admin → API) |
| 503 | Сервис не ready (import/MV) |

### Пример curl

```bash
curl -sS -X POST 'https://geoip.example.com/api/v1/lookup' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{"ip":"8.8.8.8","include":["city","country","asn"]}'
```

### NPM: публичный lookup за Access List

Чтобы UI был за Access List, а lookup — доступен интеграторам:

1. Основной Proxy Host → **Access** → `geoip-internal`
2. **Custom Locations → Add Location:**
   - **Location:** `/api/v1/lookup`
   - **Forward Hostname / IP:** тот же
   - **Forward Port:** `8080`
   - **Access List:** **None**
3. Advanced custom location → Custom Nginx Configuration:

```nginx
proxy_set_header X-GeoIP-Client-Auth 1;
```

> **Критично:** без `X-GeoIP-Client-Auth: 1` nginx подставит internal key из `proxy.env` — публичный endpoint будет доступен **без** ключа клиента.

4. Admin → API: **API auth enabled** — включено (production default)

### Другие data-plane endpoint'ы

Таблицы, export, metrics тоже требуют `X-API-Key` при `authEnabled=true`. Для M2M интеграций используйте тот же External IP Lookup key. Полный список: [СПРАВОЧНИК-API.md](СПРАВОЧНИК-API.md).

UI-документация: страница `/api-docs` (за NPM Access List).

### Безопасность ключа

- Один ключ на проект; при утечке — Generate новый в Admin → API, redeploy `geoip_web` (обновится `proxy.env`)
- **Не** передавайте ключ в URL query string
- Держите **API auth enabled** в production

---

## Google Maps API key

Ключ задаётся в Admin → **Интеграции**. Подхватывается через `GET /api/v1/public/runtime` — пересборка web не нужна.

В Google Cloud Console:

- **Application restrictions:** HTTP referrers
- **Referrers:** `https://geoip.example.com/*`

Ключ **публично** отдаётся клиенту через runtime endpoint — ограничение по referrer обязательно.

---

## CORS

По умолчанию GeoIP — same-origin (SPA и API через один nginx в `web`).

Если API на отдельном домене — задайте `corsOrigin` в Admin → API. Для типичного деплоя (один домен через NPM) менять не нужно.

---

## Чеклист безопасного production

- [ ] Только `:8080` exposed; Postgres и API не на хосте
- [ ] NPM HTTPS + Access List на UI / `/admin`
- [ ] External IP Lookup key создан на `/admin/setup-api-key`
- [ ] `CONFIG_MASTER_KEY` задан и сохранён в backup (или backup `.master-key`)
- [ ] `POSTGRES_PASSWORD` изменён от default `geoip` (compose + pgbouncer userlist)
- [ ] Google Maps key с HTTP referrer restriction
- [ ] NPM custom location для lookup с `X-GeoIP-Client-Auth: 1` (если нужен публичный API)
- [ ] `./scripts/check-public-ready.sh` перед push в public GitHub

Подробнее: [РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md](РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md)

---

## Troubleshooting NPM

| Симптом | Решение |
|---------|---------|
| 502 Bad Gateway | `docker compose ps` — `geoip_web` и `geoip_api` healthy; Forward Port = 8080 |
| SSL не выпускается | DNS → NPM; порт 80 открыт с интернета |
| Admin 401 после NPM | Cookies: SameSite=Lax при same-origin через NPM |
| API 401 на Dashboard | `authEnabled=true`; nginx читает `proxy.env` — redeploy web если volume пуст при старте |
| External lookup 401 | Custom location + `X-GeoIP-Client-Auth: 1`; ключ из Admin → API |
| `/ready` = not_ready | Нормально до первого import — [БЫСТРЫЙ-СТАРТ.md](БЫСТРЫЙ-СТАРТ.md) |

---

## См. также

- [СПРАВОЧНИК-API.md](СПРАВОЧНИК-API.md) — все endpoint'ы
- [АДМИНИСТРИРОВАНИЕ.md](АДМИНИСТРИРОВАНИЕ.md) — API auth, rate limits
- [РАЗВЁРТЫВАНИЕ.md](РАЗВЁРТЫВАНИЕ.md) — деплой stack

**Finenumbers** · [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
