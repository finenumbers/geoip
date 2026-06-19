FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
RUN pnpm --filter @geoip/shared build && pnpm --filter @geoip/api build

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache postgresql16-client
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/api/migrations ./packages/api/migrations
WORKDIR /app/packages/api
EXPOSE 3000
CMD ["node", "dist/server.js"]
