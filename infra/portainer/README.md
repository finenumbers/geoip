# Portainer Stack — GeoIP Analytics

## Compose path (обязательно)

```
docker-compose.portainer.yml
```

**Только** `docker-compose.portainer.yml` — без bind mounts, GHCR images. После push: **Pull and redeploy** (работает только при **Control: Total**).

> **Control: Limited?** Stack создан вне Portainer — обновить нельзя. [Инструкция по пересозданию](../../docs/PORTAINER.md#stack-limited--created-outside-of-portainer-нельзя-обновить)

## Быстрый старт

| Поле | Значение |
|------|----------|
| Repository URL | `https://github.com/finenumbers/geoip` |
| Reference | `main` |
| **Compose path** | **`docker-compose.portainer.yml`** ← обязательно (не `docker-compose.yml`) |
| Environment | [`stack.env.example`](stack.env.example) |

Полная инструкция: **[docs/PORTAINER.md](../../docs/PORTAINER.md)**

---

**Finenumbers** · [finenumbers.com](https://finenumbers.com)
