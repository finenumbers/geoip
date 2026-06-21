# External IP Lookup API

Внешний доступ к IP Lookup через единый API-ключ проекта.

**Первичная настройка:** ключ создаётся на обязательном шаге `/admin/setup-api-key` (или позже в `Admin → API и безопасность → API-ключ External IP Lookup`).

**UI-документация:** страница `/api-docs` в приложении (за NPM Access List).

---

## Endpoint

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

---

## Ответ

JSON с полями `ip`, `city`, `country`, `asn`, `meta` (`datasetDate`, `queriedAt`).

---

## Коды ошибок

| HTTP | Причина |
|------|---------|
| 401 | Нет или неверный `X-API-Key` (при включённом API auth) |
| 400 | Невалидный IP |
| 422 | Ошибка валидации тела запроса |
| 429 | Превышен rate limit (Admin → API) |

---

## Пример curl

```bash
curl -sS -X POST 'https://geoip.example.com/api/v1/lookup' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -d '{"ip":"8.8.8.8","include":["city","country","asn"]}'
```

---

## NPM (production)

1. Основной Proxy Host — **Access List** на UI (`geoip-internal`).
2. **Custom Location** `/api/v1/lookup` — **без** Access List, Forward Port `8080`.
3. В Advanced custom location:

```nginx
proxy_set_header X-GeoIP-Client-Auth 1;
```

Без заголовка `X-GeoIP-Client-Auth` nginx подставит internal key — публичный endpoint будет доступен без ключа клиента.

Подробнее: [NGINX-PROXY-MANAGER.md](NGINX-PROXY-MANAGER.md).

---

## Безопасность

- Ключ один на проект; при утечке — сгенерируйте новый в Admin → API и перезапустите `geoip_web`.
- Не передавайте ключ в URL query string.
- В production держите **API auth enabled**.

См. [БЕЗОПАСНОСТЬ.md](БЕЗОПАСНОСТЬ.md).
