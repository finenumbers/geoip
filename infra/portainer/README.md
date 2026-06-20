# Portainer deployment

Production-like stack for a single Docker host behind NGINX Proxy Manager.

## Stack file

Use [`stack.compose.yml`](stack.compose.yml) in Portainer (**Stacks → Add stack → Web editor**). It includes the root [`docker-compose.yml`](../../docker-compose.yml) and [`docker-compose.prod.yml`](../../docker-compose.prod.yml) overlays.

## Environment

Copy [`stack.env.example`](stack.env.example) into Portainer stack environment variables (or maintain a `.env` file next to the compose files on the host).

After changing `POSTGRES_PASSWORD`, update [`../pgbouncer/userlist.txt`](../pgbouncer/userlist.txt) and redeploy.

## NPM (perimeter)

- Proxy Host → `http://<docker-host>:8080` (scheme **HTTP**)
- SSL + Access List on the NPM host only
- Do not publish API or Postgres ports (prod overlay)

## Post-deploy checks

```bash
curl -s http://localhost:8080/api/v1/ready
pnpm --filter @geoip/api seed:fixture   # first run on empty Postgres (CI/dev)
docker compose exec import node dist/scripts/trigger-import.js
```
