# Portainer Stack — GeoIP Analytics

Production-деплой через **Portainer → Stacks**.

## Главная инструкция

**[docs/PORTAINER.md](../../docs/PORTAINER.md)** — пошаговый гайд.

## Быстрый старт

**Portainer → Stacks → Add stack → Repository**

| Поле | Значение |
|------|----------|
| Repository URL | `https://github.com/finenumbers/geoip` |
| Reference | `main` |
| **Compose path** | **`docker-compose.yml`** |
| Environment | см. [`stack.env.example`](stack.env.example) — **обязательно `COMPOSE_FILE`** |

Deploy → `http://<host>:8080/admin/setup`

## Файлы

| Файл | Назначение |
|------|------------|
| [`stack.env.example`](stack.env.example) | Environment variables (включая `COMPOSE_FILE`) |
| [`docker-compose.images.yml`](docker-compose.images.yml) | GHCR-образы вместо локальной сборки |
| [`stack.compose.yml`](stack.compose.yml) | Legacy (сборка на хосте; не для Portainer CE) |

---

**Finenumbers** · [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
