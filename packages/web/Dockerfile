FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install
COPY packages/shared ./packages/shared
COPY packages/web ./packages/web
ARG APP_BUILD=
RUN VITE_APP_BUILD="${APP_BUILD}" pnpm --filter @geoip/shared build && pnpm --filter @geoip/web build

FROM nginx:alpine AS runner
RUN apk add --no-cache gettext
COPY packages/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY packages/web/docker-entrypoint.sh /docker-entrypoint.sh
COPY packages/web/config-watch.sh /config-watch.sh
RUN chmod +x /docker-entrypoint.sh /config-watch.sh
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["sh", "-c", "/config-watch.sh & exec nginx -g 'daemon off;'"]
