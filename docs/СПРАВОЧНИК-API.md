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

## Data plane (API key if enabled)

Все endpoint'ы ниже используют `verifyApiKeyIfEnabled` — при `authEnabled=true` требуют `X-API-Key`.

Table city/country требуют готовые MV (`ensureMaterializedViewsReady`) — иначе **503**.  
`/table/rir` требует `rir_dataset_state` ready — иначе **503** `RirNotReady` (GeoIP `/ready` не зависит от RIR).

---

### POST `/lookup`

IP lookup (longest-prefix match).

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

### GET `/table/rir`

Browse table с pagination.  
`/table/rir` — NRO delegated stats (отдельный data plane); готовность `rir_dataset_state`, не MV ГРЧЦ. При пустом снимке — **503** `RirNotReady`.

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

### GET `/table/metadata/facet`

Значения для facet-фильтров.

**Query:**

| Param | Описание |
|-------|----------|
| `tableType` | `city` \| `country` \| `rir` |
| `field` | Имя поля facet |
| `search` | Поиск по значениям |
| `limit` | 1–100 (default 50) |
| `contextFilters` | JSON FilterClause[] |

**Response 200:** `{ "items": [{ "value", "count" }], "meta": { "source", "timedOut" } }`

---

### POST `/exports/table`

Создать async export job.

**Body:**

```json
{
  "tableType": "city",
  "filters": [],
  "sort": [{ "field": "network", "dir": "asc" }]
}
```

| HTTP | Описание |
|------|----------|
| 202 | `{ "id", "status": "queued", "tableType", "createdAt", "estimatedRows" }` |
| 422 | Validation / row limit exceeded |
| 503 | MV refreshing |

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
- UI: `/api-docs`

**Finenumbers** · [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
