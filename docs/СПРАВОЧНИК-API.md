# Справочник API

HTTP API GeoIP Analytics. Base path: `/api/v1`.

Полные Zod-схемы: `packages/shared/src/api-contracts/`.

---

## Аутентификация

| Тип | Механизм | Endpoint'ы |
|-----|----------|------------|
| **Нет** | — | `/health`, `/ready`, `/public/*`, `/admin/auth/status`, `/admin/auth/setup`, `/admin/auth/login` |
| **Admin session** | Cookie `geoip_admin_session` | `/admin/*` (кроме auth status/setup/login) |
| **API key** | Header `X-API-Key` | Data-plane при `authEnabled=true` |

Production default: `authEnabled=true`. SPA получает key через nginx (`proxy.env`); внешние клиенты передают свой External IP Lookup key.

Rate limit: Admin → API (default 100 req / 60 s). Ответ **429** при превышении.

---

## Public

### GET `/health`

Liveness probe.

**Auth:** нет

**Response 200:**

```json
{ "status": "ok", "timestamp": "2026-06-20T12:00:00.000Z" }
```

---

### GET `/ready`

Readiness probe.

**Auth:** нет

**Response:**

| status | HTTP | Описание |
|--------|------|----------|
| `ready` | 200 | Все checks OK |
| `degraded` | 503 | Core ready; ASN или import in progress |
| `not_ready` | 503 | БД/MV/dataset не готовы |

```json
{
  "status": "ready",
  "checks": {
    "database": true,
    "dataset": true,
    "materializedViews": true,
    "productionIndexes": true,
    "asnMapping": true,
    "importRunning": false
  },
  "timestamp": "2026-06-20T12:00:00.000Z"
}
```

---

### GET `/public/setup-checklist`

Onboarding checklist (без auth).

**Response 200:**

```json
{
  "steps": [
    { "id": "adminAccount", "label": "...", "done": true, "href": "/admin/setup" },
    { "id": "externalLookupApiKey", "label": "...", "done": false, "href": "/admin/setup-api-key" }
  ],
  "blockingReady": false
}
```

Step IDs: `adminAccount`, `externalLookupApiKey`, `grchcCredentials`, `datasetImported`, `rirDatasetImported`, `autoImportsConfigured`, `googleMapsKey`.

---

### GET `/public/runtime`

Публичная runtime-конфигурация для web.

**Response 200:**

```json
{
  "googleMapsApiKey": "...",
  "displayTimezone": "Europe/Moscow"
}
```

---

### GET `/public/client-ip`

IP клиента (с учётом X-Forwarded-For).

**Response 200:** `{ "ip": "203.0.113.1" }`

---

### GET `/public/external-ip`

Публичный IP сервера (outbound lookup).

**Response 200:** `{ "ip": "198.51.100.1" }`

---

## Admin auth

### GET `/admin/auth/status`

**Response 200:** `{ "setupComplete": true }`

---

### POST `/admin/auth/setup`

Первичное создание admin (только если setup не завершён).

**Body:**

```json
{ "username": "admin", "password": "...", "confirmPassword": "..." }
```

| HTTP | Описание |
|------|----------|
| 200 | `{ "ok": true, "username": "..." }` + session cookie |
| 400 | Setup already complete / validation |
| 422 | Validation error |
| 429 | Rate limit (5 attempts / 15 min per IP) |

---

### POST `/admin/auth/login`

**Body:** `{ "username": "...", "password": "..." }`

| HTTP | Описание |
|------|----------|
| 200 | Session + cookie |
| 401 | Неверный логин/пароль |
| 503 | SetupRequired |
| 429 | Rate limit |

---

### POST `/admin/auth/logout`

**Response 200:** `{ "ok": true }` — cookie cleared.

---

### GET `/admin/auth/me`

**Auth:** admin session

**Response 200:** `{ "username": "...", "expiresAt": "..." }`

---

## Admin config (session)

### GET `/admin/config`

Полная конфигурация (secrets masked).

### PUT `/admin/config`

Partial patch settings + secrets. См. `adminConfigPatchSchema` в `@geoip/shared`.

| HTTP | Описание |
|------|----------|
| 200 | Updated config |
| 400 | AdminConfigError |

---

### GET `/admin/config/reload-status`

**Response 200:**

```json
{
  "configUpdatedAt": "2026-06-20T12:00:00.000Z",
  "pendingReload": { "apiRestart": [], "webReload": [] }
}
```

---

### POST `/admin/config/test/grchc`

Probe ЛК ГРЧЦ без import.

| HTTP | Описание |
|------|----------|
| 200 | `{ "ok": true, "downloadCount": N, "latestDate": "YYYYMMDD" }` |
| 400 | MissingCredentials |
| 502 | GrchcProbeFailed |

---

### POST `/admin/imports/trigger`

Ручной запуск import.

| HTTP | Описание |
|------|----------|
| 200 | `{ "ok": true, "importRunId": "uuid" }` |
| 409 | ImportAlreadyRunning |

---

### GET `/admin/rir/status`

Статус параллельного слоя NRO delegated (`rir_dataset_state`).

**Response 200:** `status`, `lastSuccessAt`, `lastSnapshotDate`, `rowCount`, `rowsByRegistry`, `rowsByStatus`, `snapshotsByRegistry`, `lastError`.

### POST `/admin/rir/test`

Probe доступности 6 delegated latest-файлов (5 RIR + IANA) без записи в БД.

| HTTP | Описание |
|------|----------|
| 200 | `{ "ok": true, "reachableCount": 6, "sources": [{ registry, sourceFile, httpStatus, ok, snapshotDate, recordCount, error }] }` |
| 502 | `RirProbeFailed` (частичный `sources` в теле) |

### POST `/admin/rir/imports/trigger`

Очередь импорта latest-файлов 5 RIR + IANA.

| HTTP | Описание |
|------|----------|
| 200 | `{ "importRunId": "uuid", "status": "queued" }` |
| 409 | `RirImportAlreadyRunning` — в теле `importRunId`, `status`, подсказка про reset |

### POST `/admin/rir/imports/reset`

Сброс зависших `queued`/`running` runs и флага `importing` (ops без SQL).

| HTTP | Описание |
|------|----------|
| 200 | `{ "ok": true, "clearedRuns": N }` |

---

### POST `/admin/data/wipe`

Полная очистка датасетов ГРЧЦ + RIR, истории import/export, ZIP cache, `rir_rdap_cache` и таблицы расхождений CC (`geo_rir_cc_mismatches` → state `never`). Config/secrets и схема сохраняются. Требует admin session. Сериализуется с rebuild расхождений через advisory lock.

| HTTP | Описание |
|------|----------|
| 200 | `{ "ok": true, "grchcImportRunsDeleted", "rirImportRunsDeleted", "exportJobsDeleted", "exportFilesRemoved", "zipCacheCleared" }` |

После wipe нужны повторные импорты; сравнение CC пересоберётся автоматически при готовности обоих слоёв.

### GET `/admin/config/api-key`

Plaintext External API key для страницы `/api-docs`. Только admin session.

**Response 200:** `{ "apiKey": "…" }` (пустая строка, если ключ не задан).

---

## Data plane (API key if enabled)

Все endpoint'ы ниже используют `verifyApiKeyIfEnabled` — при `authEnabled=true` требуют `X-API-Key`.

**Готовность по плоскостям:**

| Endpoint | Требование | Иначе |
|----------|------------|-------|
| `/table/city`, `/table/country`, `/table/asn` | MV ГРЧЦ ready | **503** |
| `/table/rir`, `POST /rir/lookup` | `rir_dataset_state` ready | **503** `RirNotReady` |
| `/table/cc-mismatch*` | нет (данные читаются даже при `never`/`failed`) | — |
| `POST /exports/table` + `tableType` city/country/asn | MV ready | **503** |
| `POST /exports/table` + `tableType` rir | RIR ready | **503** |

GeoIP `/ready` **не** зависит от RIR и от слоя расхождений CC.  
UI `/api-docs` требует **admin session** (не API key); примеры на странице подставляют ключ из `GET /admin/config/api-key`.

---

### POST `/lookup`

IP lookup ГРЧЦ (longest-prefix match по city/country/asn blocks).

**Body:**

```json
{
  "ip": "8.8.8.8",
  "include": ["city", "country", "asn"]
}
```

| HTTP | Описание |
|------|----------|
| 200 | LookupResponse |
| 400 | Invalid IP |
| 401 | Missing/invalid API key |
| 422 | Validation error |
| 429 | Rate limit |

**Response 200 (фрагмент):**

```json
{
  "ip": "8.8.8.8",
  "city": { "network": "...", "cityName": "...", "latitude": 37.4, "longitude": -122.1 },
  "country": { "countryIsoCode": "US", "countryName": "United States" },
  "asn": { "asn": 15169, "organization": "GOOGLE" },
  "meta": { "datasetDate": "20260601", "queriedAt": "2026-06-20T12:00:00.000Z" }
}
```

---

### POST `/rir/lookup`

Single-IP lookup в снимке RIR: покрывающий `ipv4`/`ipv6` CIDR (`network >>= ip`, longest prefix). Только PostgreSQL — без RDAP.

**Body:** `{ "ip": "8.8.8.8" }`

| HTTP | Описание |
|------|----------|
| 200 | `{ ip, delegation, meta: { snapshotDate, queriedAt } }` — `delegation` может быть `null` |
| 400 | Invalid IP |
| 503 | `RirNotReady` |

Поля `delegation`: `registry`, `cc`, `status`, `resourceType`, `rangeText`, `network`, `prefixLen`, `ipFamily`, `allocatedAt`, `opaqueId`, `startAsn`, `asnCount`.  
Семантика `cc` — legal country of holder, не ISO геолокации ГРЧЦ.

---

### POST `/rir/enrich`

Live RDAP (+ PeeringDB для ASN) по известной delegation-строке. Обычно после `/rir/lookup`. Кэш ~7 дней.

**Body:** `{ "registry", "resourceType", "rangeText", "network?", "startAsn?", "opaqueId?" }`

| HTTP | Описание |
|------|----------|
| 200 | `{ rdap, peeringdb }` (ошибки RDAP часто в `rdap.errorMessage`, не 5xx) |
| 502 | `EnrichmentFailed` |

Не включайте enrich в hot-path массовых lookup.

---

### GET `/dataset/active`

Состояние активного датасета.

**Response 200:** `datasetDate`, `activatedAt`, `mvStatus`, `volumes`, `databaseSizeBytes`, `nextImportAt`, `exportMaxRows`, …

---

### GET `/rir/status`

Read-only статус снимка NRO delegated (для Dashboard). Не влияет на GeoIP `/ready`.

**Response 200:** `status`, `lastSuccessAt`, `lastSnapshotDate`, `rowCount`, `rowsByRegistry`, `rowsByStatus`, `snapshotsByRegistry`, `lastError`.

---

### GET `/imports`

История import runs.

**Query:** `limit` (1–100, default из config)

**Response 200:** `{ "items": [ ImportRun, ... ] }`

Import status: `queued`, `running`, `validating`, `swapping`, `refreshing_mv`, `succeeded`, `failed`.

---

### GET `/imports/:id`

**Params:** `id` — UUID

| HTTP | Описание |
|------|----------|
| 200 | ImportRun с steps |
| 404 | Not found |
| 422 | Invalid UUID |

---

### GET `/table/city`

### GET `/table/country`

### GET `/table/asn`

### GET `/table/rir`

Browse table с pagination (keyset или offset).

| Path | Data plane | Готовность |
|------|------------|------------|
| `/table/city`, `/table/country`, `/table/asn` | MV / ASN mapping ГРЧЦ | MV ready → иначе **503** |
| `/table/rir` | `rir_delegations` (NRO delegated + IANA) | RIR ready → иначе **503** `RirNotReady` |

UI разделяет RIR на `/browse/rir` (ipv4+ipv6) и `/browse/rir-asn` (asn) через locked filter `resource_type`; API один — `/table/rir`.

**Query (основные):**

| Param | Описание |
|-------|----------|
| `page` | Номер страницы (default 1) |
| `pageSize` | 1–200 (default 50) |
| `sort` | JSON array `[{ "field", "dir": "asc"|"desc" }]` |
| `filters` | JSON array FilterClause |
| `afterId`, `afterNetwork`, `afterSortValue` | Keyset cursor |

**Response 200:** `rows`, `pagination`, `meta` (queryMs, paginationMode, nextCursor, hints)

Filter operators: `eq`, `neq`, `contains`, `startsWith`, `in`, `gt`, `gte`, `lt`, `lte`, …

---

### GET `/table/cc-mismatch`

Таблица материализованных расхождений ISO country block ГРЧЦ vs covering RIR CC.  
Только mismatches; совпадения не хранятся. Auth: API key (если включён). **Без** gate MV/RIR readiness.

**Query:** те же параметры pagination/sort/filters, что у Browse (`page`, `pageSize`, `sort`, `filters`, `afterId`, `afterSortValue`).

**Поля строки (camelCase):** `id`, `countryBlockId`, `network`, `grchcCc`, `rirCc`, `registry`, `rangeText`, `asn`, `asnOrg`, `rebuiltAt`.

**Фильтры:** `network`, `grchc_cc`, `rir_cc`, `registry`, `range_text`, `asn`, `asn_org`.  
**Sort:** те же + `id`. Пустой sort → `network ASC`.  
**Keyset:** при одноколоночном sort; для `asn` курсор — `integer` / `NULL` (не text).

**Response 200:** `rows`, `pagination`, `meta` (в т.ч. `paginationMode`, `nextCursor`, `rebuildStatus`, `rebuiltAt`, `rebuildDurationMs`, `rebuildError`, `browseView: "geo_rir_cc_mismatches"`, `countSource: "exact"`).

---

### GET `/table/cc-mismatch/state`

Статус job пересчёта расхождений.

**Response 200:**

```json
{
  "status": "ready",
  "rowCount": 12345,
  "rebuiltAt": "2026-07-21T12:00:00.000Z",
  "durationMs": 420000,
  "lastError": null
}
```

`status`: `never` | `running` | `ready` | `failed`.

Пересчёт: после успешного импорта ГРЧЦ или RIR; при старте API (backfill `never`/`failed`/stale `running`); только если оба датасета ready. Ошибка rebuild не валит импорт.

---

### GET `/table/cc-mismatch/facet`

Facet-значения для UI фильтров страницы расхождений.

**Query:**

| Param | Описание |
|-------|----------|
| `field` | `grchc_cc` \| `rir_cc` \| `registry` \| `asn_org` (default `grchc_cc`) |
| `search` | Поиск по значениям |
| `limit` | 1–100 (default 50) |
| `contextFilters` | JSON FilterClause[] |

**Response 200:** `{ "items": [{ "value", "count" }], "meta": { "source": "index" } }`

---

### GET `/table/metadata/facet`

Значения для facet-фильтров Browse (ГРЧЦ / RIR / ASN).

**Query:**

| Param | Описание |
|-------|----------|
| `tableType` | `city` \| `country` \| `rir` \| `asn` |
| `field` | Имя поля facet |
| `search` | Поиск по значениям |
| `limit` | 1–100 (default 50) |
| `contextFilters` | JSON FilterClause[] |

**Response 200:** `{ "items": [{ "value", "count" }], "meta": { "source", "timedOut" } }`

Для facet страницы расхождений используйте `/table/cc-mismatch/facet`, не этот endpoint.

---

### POST `/exports/table`

Создать async export job. `tableType` для расхождений CC **не поддерживается**.

**Body:**

```json
{
  "tableType": "city",
  "filters": [],
  "sort": [{ "field": "network", "dir": "asc" }]
}
```

`tableType`: `city` | `country` | `rir` | `asn`.

| HTTP | Описание |
|------|----------|
| 202 | `{ "id", "status": "queued", "tableType", "createdAt", "estimatedRows" }` |
| 422 | Validation / row limit exceeded |
| 503 | MV refreshing (city/country/asn) **или** RIR dataset not ready (`tableType=rir`) |

ZIP entry: `geoip-{tableType}-export.csv`.

---


### GET `/exports/:id`

Статус export job. **Params:** UUID.

**Response 200:** `id`, `status`, `tableType`, `createdAt`, `finishedAt`, `errorMessage`, `rowCount`

Status: `queued`, `running`, `succeeded`, `failed`.

---

### GET `/exports/:id/download`

Скачать ZIP с CSV. Только `status=succeeded`.

| HTTP | Описание |
|------|----------|
| 200 | application/zip stream |
| 404 | Export not ready / file not found |

---

### GET `/metrics`

Operational metrics (latency P95, import benchmark, pg_stat_statements).

**Response 200:** см. `MetricsResponse` в `@geoip/shared`.

---

## Общие коды ошибок

| HTTP | Формат |
|------|--------|
| 401 | `{ "error": "Unauthorized", "message": "..." }` |
| 422 | `{ "error": "Validation error", "details": ... }` |
| 503 | `{ "error": "Service unavailable", "message": "..." }` |
| 500 | Generic message в production (без stack trace) |

---

## См. также

- [ПЕРИМЕТР-И-HTTPS.md](ПЕРИМЕТР-И-HTTPS.md) — NPM, external lookup
- [АДМИНИСТРИРОВАНИЕ.md](АДМИНИСТРИРОВАНИЕ.md) — rate limits, API keys
- UI: `/api-docs` (admin session; примеры с реальным ключом)

**Finenumbers** · [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
