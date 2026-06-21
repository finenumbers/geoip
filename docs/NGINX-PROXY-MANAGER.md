# NGINX Proxy Manager (NPM)

Пошаговая настройка HTTPS и ограничения доступа к GeoIP Analytics поверх Docker Compose или Portainer.

**Репозиторий:** [github.com/finenumbers/geoip](https://github.com/finenumbers/geoip)

---

## Предварительные условия

1. GeoIP stack запущен (Portainer или `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`)
2. Контейнер `geoip_web` слушает порт **8080** на хосте Docker
3. NPM установлен (отдельный контейнер или хост) и имеет сетевой доступ к хосту с Docker
4. DNS A/AAAA запись домена указывает на сервер с NPM

> **Важно:** в production overlay порты API (`3000`) и Postgres **не** публикуются. Единственная точка входа — `web:8080`.

---

## Шаг 1. Proxy Host

1. NPM → **Hosts** → **Proxy Hosts** → **Add Proxy Host**
2. **Domain Names:** `geoip.example.com` (ваш домен)
3. **Scheme:** `http`
4. **Forward Hostname / IP:**
   - NPM на том же хосте, что Docker: `127.0.0.1` или IP хоста
   - NPM в Docker на той же сети: имя сервиса/контейнера или IP хоста
5. **Forward Port:** `8080`
6. **Block Common Exploits:** включить
7. **Websockets Support:** выключить (не требуется для GeoIP)

Сохраните без SSL — сначала проверьте HTTP.

---

## Шаг 2. Проверка HTTP

```bash
curl -sI http://geoip.example.com/api/v1/health
# Ожидается: HTTP/1.1 200
```

Откройте в браузере: `http://geoip.example.com/admin/setup`

---

## Шаг 3. SSL (Let's Encrypt)

1. Откройте созданный Proxy Host → вкладка **SSL**
2. **SSL Certificate:** Request a new SSL Certificate
3. **Force SSL:** включить
4. **HTTP/2 Support:** включить (рекомендуется)
5. **HSTS Enabled:** включить после успешной проверки
6. Email для Let's Encrypt — укажите рабочий
7. Согласитесь с Terms of Service → Save

NPM получит сертификат автоматически. Сертификат хранится в NPM, не в контейнере GeoIP.

---

## Шаг 4. Access List (рекомендуется)

Ограничьте доступ к админке и UI:

1. NPM → **Access Lists** → **Add Access List**
2. **Name:** `geoip-internal`
3. **Authorization:**
   - **Satisfy Any** или **Satisfy All** — по политике
   - Добавьте **Access** → разрешённые IP (офис, VPN)
   - Или **HTTP Username/Password** для дополнительного слоя
4. Сохраните

5. Proxy Host → вкладка **Advanced** (или **Custom locations**):

   **Вариант A — весь сайт за Access List:**  
   Proxy Host → **Access** → выберите `geoip-internal`

   **Вариант B — только `/admin`:**  
   Custom location `/admin` → Access List `geoip-internal`  
   Остальной сайт — публичный или с отдельной политикой

---

## Шаг 4b. External IP Lookup API (опционально)

Чтобы внешние интеграции вызывали lookup **без** доступа к UI:

1. Основной Proxy Host → **Access** → `geoip-internal` (UI, таблица, admin)
2. **Custom Locations** → Add Location:
   - **Location:** `/api/v1/lookup`
   - **Forward Hostname / IP:** тот же, что у основного host
   - **Forward Port:** `8080`
   - **Access List:** **None** (публичный endpoint)
3. Вкладка **Advanced** custom location → Custom Nginx Configuration:

```nginx
proxy_set_header X-GeoIP-Client-Auth 1;
```

4. В Admin → API:
   - **API auth enabled** — включено
   - Скопируйте **API key** и передайте интеграторам

Клиенты вызывают `POST /api/v1/lookup` с заголовком `X-API-Key`. Без ключа — **401**.

Документация: [EXTERNAL-API.md](EXTERNAL-API.md), страница `/api-docs` в UI.

> **Важно:** без `X-GeoIP-Client-Auth` nginx подставит internal key и публичный lookup будет доступен без ключа клиента.

---

## Шаг 5. Custom headers (опционально)

В **Advanced** → **Custom Nginx Configuration** для Proxy Host:

```nginx
# Доверять NPM как reverse proxy (если API когда-либо exposed напрямую)
# proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
# proxy_set_header X-Forwarded-Proto $scheme;
# proxy_set_header Host $host;
```

Для стандартного NPM Proxy Host эти заголовки уже выставляются.

---

## Шаг 6. CORS (если SPA на другом домене)

По умолчанию GeoIP — same-origin (SPA и API через один nginx в `web`).

Если API на отдельном домене — задайте `corsOrigin` в Admin → API. Для типичного деплоя (один домен через NPM) менять не нужно.

---

## Шаг 7. Google Maps API key

Ключ задаётся в Admin → Интеграции. В Google Cloud Console ограничьте:

- **Application restrictions:** HTTP referrers
- **Referrers:** `https://geoip.example.com/*`

---

## Troubleshooting

| Симптом | Решение |
|---------|---------|
| 502 Bad Gateway | `docker compose ps` — `geoip_web` и `geoip_api` healthy; проверьте Forward Port 8080 |
| SSL не выпускается | DNS должен резолвиться на NPM; порт 80 открыт с интернета |
| Admin 401 после NPM | Cookies: SameSite=Lax работает при same-origin через NPM |
| API 401 в production | API auth включён; SPA: nginx injects key из `proxy.env`; external lookup: клиент передаёт `X-API-Key` |
| External lookup 401 | Проверьте custom location + `X-GeoIP-Client-Auth: 1`; ключ из Admin → API |
| `/ready` = not_ready | Нормально до первого import; см. [FAQ.md](FAQ.md) |

---

## Схема трафика

```
Internet → NPM (443/TLS) → host:8080 → geoip_web (nginx)
                                              ├─ / → SPA
                                              ├─ /api/v1/lookup → api (+ client or internal X-API-Key)
                                              └─ /api/* → geoip_api:3000 (+ injected X-API-Key)
```

---

## См. также

- [УСТАНОВКА.md](УСТАНОВКА.md) — полная установка
- [БЕЗОПАСНОСТЬ.md](БЕЗОПАСНОСТЬ.md) — секреты и perimeter
- [EXTERNAL-API.md](EXTERNAL-API.md) — внешний IP Lookup API
- [FAQ.md](FAQ.md) — типичные проблемы

**Контакты:** [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
