# GeoIP Analytics

Веб-сервис аналитики и поиска по официальным CSV-выгрузкам ГРЧЦ РФ (GeoIP): browse, facet-фильтры, IP lookup, экспорт CSV.

**Репозиторий:** [github.com/finenumbers/geoip](https://github.com/finenumbers/geoip)

Разработано **[Finenumbers](https://finenumbers.com)** — оператор телефонной связи для бизнеса.  
По всем вопросам: **apps@finenumbers.com**

## Стек

Node.js · TypeScript · Fastify · PostgreSQL · React · Docker Compose · NGINX Proxy Manager

## С чего начать

| Роль | Начните здесь |
|------|---------------|
| **Оператор** (деплой, Admin, import) | [docs/БЫСТРЫЙ-СТАРТ.md](docs/БЫСТРЫЙ-СТАРТ.md) |
| **Пользователь UI** (Dashboard, таблицы, lookup) | [docs/РУКОВОДСТВО-ПОЛЬЗОВАТЕЛЯ.md](docs/РУКОВОДСТВО-ПОЛЬЗОВАТЕЛЯ.md) |
| **Интегратор** (внешний API, NPM) | [docs/ПЕРИМЕТР-И-HTTPS.md](docs/ПЕРИМЕТР-И-HTTPS.md) · [docs/СПРАВОЧНИК-API.md](docs/СПРАВОЧНИК-API.md) |
| **Разработчик** | [docs/РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md](docs/РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md) |
| **Архитектор** | [docs/АРХИТЕКТУРА.md](docs/АРХИТЕКТУРА.md) |

## Документация

| Документ | Описание |
|----------|----------|
| **[docs/БЫСТРЫЙ-СТАРТ.md](docs/БЫСТРЫЙ-СТАРТ.md)** | Первый запуск: 7 шагов onboarding, `/ready`, первый lookup |
| [docs/РАЗВЁРТЫВАНИЕ.md](docs/РАЗВЁРТЫВАНИЕ.md) | Portainer, Docker Compose CLI, volumes, backup, обновление |
| [docs/ПЕРИМЕТР-И-HTTPS.md](docs/ПЕРИМЕТР-И-HTTPS.md) | NPM, HTTPS, Access List, External IP Lookup API |
| [docs/АДМИНИСТРИРОВАНИЕ.md](docs/АДМИНИСТРИРОВАНИЕ.md) | Admin UI, config store, import, все секции настроек |
| [docs/РУКОВОДСТВО-ПОЛЬЗОВАТЕЛЯ.md](docs/РУКОВОДСТВО-ПОЛЬЗОВАТЕЛЯ.md) | Dashboard, Browse, Lookup, Export, `/api-docs` |
| [docs/СПРАВОЧНИК-API.md](docs/СПРАВОЧНИК-API.md) | Полный список HTTP endpoint'ов |
| [docs/АРХИТЕКТУРА.md](docs/АРХИТЕКТУРА.md) | Data plane, workers, config store, security model |
| [docs/РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md](docs/РАЗРАБОТКА-И-БЕЗОПАСНОСТЬ.md) | Локальная разработка, безопасность, troubleshooting |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Backlog улучшений (LOW/MEDIUM) |

Portainer (кратко): [infra/portainer/README.md](infra/portainer/README.md)

## Monorepo

```
packages/shared/   # schemas, defaults, API contracts
packages/api/      # Fastify + import/export workers
packages/web/      # React SPA
docs/              # документация (RU)
```

## Лицензия

[MIT](LICENSE) © Finenumbers
