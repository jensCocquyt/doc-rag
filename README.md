# doc-rag

Document Chat RAG — production-oriented POC. Upload PDFs, ask questions, get streamed answers with exact page-and-highlight citations. See [docs/PLAN.md](docs/PLAN.md) for the full build plan and [docs/decisions](docs/decisions) for architecture decisions.

## Prerequisites

- Node.js 22 LTS (`.nvmrc`)
- pnpm 10+
- Docker Desktop (or another Compose-compatible Docker installation), running

## Getting started

```sh
pnpm install          # install dependencies
pnpm infra:up         # start PostgreSQL (pgvector) + Azurite via Docker Compose
cp .env.example .env  # local env; api/worker load it automatically
pnpm dev              # start web, api and worker through Nx (hot reload)
```

- Web: http://localhost:4200
- API: http://localhost:3000 (health: `GET /health`)
- PostgreSQL: localhost:5432 · Azurite Blob: localhost:10000 · Queue: localhost:10001

All infrastructure credentials are development-only (see `.env.example` and `docker-compose.yml`).

## Commands

```sh
pnpm infra:up           # docker compose up -d --wait
pnpm infra:down         # stop containers, keep data
pnpm infra:logs         # follow infrastructure logs
pnpm infra:reset        # stop containers AND delete volumes (explicit only)

pnpm dev                # web + api + worker via Nx
pnpm check              # nx run-many -t build lint test
pnpm build / lint / test
pnpm test:integration   # needs running infrastructure (pnpm infra:up)
pnpm nx affected -t build lint test
pnpm nx test config     # single project; append -- --testNamePattern="..." for one test
```

## Layout

- `apps/web` — React + Vite UI
- `apps/api` — NestJS (Fastify) API
- `apps/ingestion-worker` — queue-driven ingestion worker
- `libs/contracts` / `libs/config` / `libs/testing` — shared Zod contracts, validated env config, test helpers
- `docker-compose.yml` — local infrastructure only (postgres + azurite); apps run as host processes
