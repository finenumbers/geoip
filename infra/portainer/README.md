# Portainer Stack — GeoIP Analytics

Production-деплой через **Portainer → Stacks**.

## Главная инструкция

**[docs/PORTAINER.md](../../docs/PORTAINER.md)** — пошаговый гайд: создание stack из GitHub, переменные окружения, Admin setup, import ГРЧЦ, обновление, troubleshooting.

## Файлы

| Файл | Назначение |
|------|------------|
| [`stack.compose.yml`](stack.compose.yml) | Compose path для Portainer (`include` корневых файлов) |
| [`stack.env.example`](stack.env.example) | Шаблон Environment variables |

Корневые compose (подключаются автоматически):

- [`docker-compose.yml`](../../docker-compose.yml)
- [`docker-compose.prod.yml`](../../docker-compose.prod.yml)

## Быстрый старт (5 полей)

**Portainer → Stacks → Add stack → Repository**

| Поле | Значение |
|------|----------|
| Repository URL | `https://github.com/finenumbers/geoip` |
| Reference | `main` |
| Compose path | `infra/portainer/stack.compose.yml` |
| Environment | см. [`stack.env.example`](stack.env.example) |

Deploy → `http://<host>:8080/admin/setup`

---

**Finenumbers** · [finenumbers.com](https://finenumbers.com) · apps@finenumbers.com
