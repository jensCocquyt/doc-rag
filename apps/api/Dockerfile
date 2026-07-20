# Build context: repository root, after
#   pnpm nx run api:build && pnpm nx run api:prune
# which produce dist/apps/api (bundle + pruned package.json + lockfile).
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY dist/apps/api/package.json dist/apps/api/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
# The webpack bundle externalizes tslib but Nx's generated package.json
# omits it; install it explicitly (version matches the workspace).
RUN pnpm add tslib@^2.8.1

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY dist/apps/api/ ./
# Non-root (PLAN.md Phase 8 container requirements).
USER node
EXPOSE 3000
CMD ["node", "main.js"]
