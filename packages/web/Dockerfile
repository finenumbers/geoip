FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install
COPY packages/shared ./packages/shared
COPY packages/web ./packages/web
RUN pnpm --filter @geoip/shared build && pnpm --filter @geoip/web build

FROM nginx:alpine AS runner
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
