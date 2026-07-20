# Build context: repository root, after
#   pnpm nx run ingestion-worker:build && pnpm nx run ingestion-worker:prune
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY dist/apps/ingestion-worker/package.json dist/apps/ingestion-worker/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
# The webpack bundle externalizes tslib but Nx's generated package.json
# omits it; install it explicitly (version matches the workspace).
RUN pnpm add tslib@^2.8.1

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY dist/apps/ingestion-worker/ ./
USER node
# No port: pull-based queue consumer. SIGTERM finishes in-flight work
# (graceful shutdown in main.ts) before exiting.
CMD ["node", "main.js"]
