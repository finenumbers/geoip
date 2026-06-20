# Portainer Stack — GeoIP Analytics

## Compose path (обязательно)

```
docker-compose.portainer.yml
```

**Не используйте** `docker-compose.yml`, `infra/portainer/stack.compose.yml` или `COMPOSE_FILE` — Portainer **игнорирует** `COMPOSE_FILE` и всегда запускает `compose build` по одному compose path. Файлы с `build:` падают с ошибкой `lstat .../packages: no such file or directory`.

## Быстрый старт

| Поле | Значение |
|------|----------|
| Repository URL | `https://github.com/finenumbers/geoip` |
| Reference | `main` |
| **Compose path** | **`docker-compose.portainer.yml`** |
| Environment | [`stack.env.example`](stack.env.example) |

Полная инструкция: **[docs/PORTAINER.md](../../docs/PORTAINER.md)**

---

**Finenumbers** · [finenumbers.com](https://finenumbers.com)
