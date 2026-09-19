# SynChronicle 多阶段构建：webui SPA + 后端
FROM node:24-alpine AS webui
WORKDIR /app/webui
COPY webui/package.json webui/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY webui/ ./
RUN pnpm build

FROM node:24-alpine AS backend
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && cp -r webui/dist ./webui-dist

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=backend /app/dist ./dist
COPY --from=backend /app/webui-dist ./webui/dist
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/package.json ./
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "dist/cli/index.js", "--port", "3000"]
