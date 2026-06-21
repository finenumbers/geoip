# Portainer Stack — GeoIP Analytics

## Compose path (обязательно)

```
docker-compose.portainer.yml
```

**Только** `docker-compose.portainer.yml` — без bind mounts, GHCR images. После push: **Pull and redeploy** (работает только при **Control: Total**).

> **Control: Limited?** Stack создан вне Portainer — обновить нельзя. [Инструкция по пересозданию](../../docs/РАЗВЁРТЫВАНИЕ.md#stack-limited-created-outside-of-portainer)

## Быстрый старт

| Поле | Значение |
|------|----------|
| Repository URL | `https://github.com/finenumbers/geoip` |
| Reference | `main` |
| **Compose path** | **`docker-compose.portainer.yml`** ← обязательно (не `docker-compose.yml`) |
| Environment | [`stack.env.example`](stack.env.example) |

Полная инструкция: **[docs/РАЗВЁРТЫВАНИЕ.md](../../docs/РАЗВЁРТЫВАНИЕ.md)** · onboarding: **[docs/БЫСТРЫЙ-СТАРТ.md](../../docs/БЫСТРЫЙ-СТАРТ.md)**

---

**Finenumbers** · [finenumbers.com](https://finenumbers.com)
