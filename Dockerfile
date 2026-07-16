FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm typecheck && pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* && corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/container-entrypoint.sh ./scripts/container-entrypoint.sh
RUN chown -R node:node /app && chmod 0555 ./scripts/container-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["./scripts/container-entrypoint.sh"]
CMD ["web"]
