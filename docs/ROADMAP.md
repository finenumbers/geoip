# Roadmap — можно улучшить позже

Backlog после аудита перед публикацией на GitHub. **Не блокирует** push и первый production deploy, но снижает операционные риски и технический долг.

Приоритеты: **MEDIUM** — имеет смысл в ближайших релизах; **LOW** — по мере необходимости.

---

## MEDIUM

### 1. Admin rate limit — только in-process

**Сейчас:** `checkAdminAuthRateLimit` хранит счётчики в памяти процесса API (`packages/api/src/utils/admin-auth-rate-limit.ts`). Лимит 5 попыток / 15 мин на IP.

**Ограничение:** сброс при restart API; не общий между несколькими репликами API.

**Направление:** Redis / shared store или rate limit на NPM для `/admin/auth/*`.

**Когда нужно:** несколько инстансов `api` за балансировщиком или частые redeploy без NPM.

---

### 2. Import API key — reserved, не используется в HTTP

**Сейчас:** `secrets.api.importApiKey` автогенерируется при первом boot и показывается в Admin → API (masked). Импорт запускается через **admin session** (`POST /api/v1/admin/imports/trigger`), не через отдельный import key.

**Путаница:** поле `IMPORT_API_KEY` в env-compat (`runtime-config.ts`) нигде не проверяется в routes.

**Направление (выбрать одно):**

- **A.** Убрать из UI/env-compat как dead surface (breaking для тех, кто уже ротировал ключ в Admin).
- **B.** Подключить к machine-to-machine trigger import (header `X-Import-Key`) для CI/automation без admin cookie.

---

### 3. Supply-chain scanning в CI

**Сейчас:** lint, test, e2e, knip, `check-public-ready.sh`. Нет автоматического audit зависимостей и SAST.

**Статус:** Dependabot и CodeQL workflow добавлены в `.github/` — triage PR по мере поступления.

**Направление:**

- Dependabot (`.github/dependabot.yml`) — PR с обновлениями npm
- CodeQL (`.github/workflows/codeql.yml`) — статический анализ JS/TS

---

### 4. Google Maps key на публичном endpoint

**Сейчас:** `GET /api/v1/public/runtime` отдаёт `googleMapsApiKey` без auth (нужно для карты в SPA).

**Mitigation (оператор):** HTTP referrer restriction в Google Cloud Console.

**Направление в коде:** optional proxy tile/embed-only key, или отдавать key только authenticated admin (усложнит Lookup map UX).

---

## LOW

### 5. Web bundle size (~590 KB gzip ~174 KB)

**Сейчас:** один chunk в Vite build (warning >500 KB).

**Направление:** `manualChunks` / lazy routes для Browse и Admin, dynamic import тяжёлых таблиц.

**Impact:** время первой загрузки SPA, не security.

---

### 6. Admin username compare без timing-safe

**Сейчас:** пароль сравнивается через scrypt + timing-safe; username — обычное строковое сравнение (`admin-config-service.ts`).

**Impact:** negligible vs password; hardening для параноидального threat model.

---

### 7. `Env.IMPORT_API_KEY` — мёртвое поле в compat layer

**Сейчас:** заполняется в `toEnvCompat`, не читается workers/routes.

**Направление:** удалить из `EnvCompat` при реализации п.2 или оставить до подключения M2M import.

---

### 8. POSTGRES defaults в compose

**Сейчас:** `geoip`/`geoip` в git для OSS quick start. Postgres не на host в prod overlay.

**Mitigation (оператор):** сменить пароль + синхронизировать PgBouncer userlist — см. [РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md](РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md), [РАЗВЁРТЫВАНИЕ.md](РАЗВЁРТЫВАНИЕ.md).

**Направление в коде:** env interpolation `POSTGRES_PASSWORD` без правки compose (D1 из аудита).

---

## Не в scope backlog (намеренно)

| Тема | Почему оставлено |
|------|------------------|
| `infra/portainer/stack.compose.yml` | Legacy regression для `portainer-self-test.sh` |
| `/api/v1/health` без SPA | Ops / Docker healthcheck by design |
| CSV row Zod validation на import | Отложено; headers + COPY достаточны на текущем объёме |

---

## Связанные документы

- [РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md](РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md) — code hygiene (`pnpm knip`, `check-public-ready.sh`), perimeter
- [АДМИНИСТРИРОВАНИЕ.md](АДМИНИСТРИРОВАНИЕ.md) — текущее поведение Admin UI
