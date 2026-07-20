# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Project: Document Chat RAG

Production-oriented RAG POC with a hard Azure budget of €130 per month.

**Current state:** Phase 0 (Nx workspace, apps, libs, health checks, CI), Phase 0A (Docker Compose replaced Aspire) and Phase 1 (Drizzle schema, migrations, repositories, seed) are complete. The full build plan, phased implementation guide, domain model, API outline and acceptance criteria live in `docs/PLAN.md`. Read it before implementing anything. Implement one phase per session; do not expand scope beyond the current phase. Architecture decisions are recorded in `docs/decisions/`.

## Stack

- Nx monorepo (single root package.json, `project.json` per project)
- React + Vite (apps/web)
- NestJS with Fastify adapter (apps/api)
- Separate TypeScript ingestion worker (apps/ingestion-worker)
- Drizzle ORM
- PostgreSQL + pgvector (source of truth; hybrid vector + full-text retrieval with RRF)
- Azure Blob Storage and Queue Storage (Azurite locally)
- Docker Compose for local infrastructure only (postgres + azurite); apps run as host Nx processes
- Vercel AI SDK with the official Azure provider (Azure OpenAI)
- Azure Container Apps, deployed via explicit Bicep + GitHub Actions

## Commands

- Start local infrastructure: `pnpm infra:up` (docker compose up -d --wait)
- Stop infrastructure: `pnpm infra:down` (keeps data); `pnpm infra:reset` deletes volumes
- Infrastructure logs: `pnpm infra:logs`
- Start all dev apps: `pnpm dev` (nx run-many -t serve --projects=web,api,ingestion-worker)
- Build / lint / test: `pnpm build` / `pnpm lint` / `pnpm test` (nx run-many)
- All checks: `pnpm check` (build lint test)
- Affected only: `pnpm nx affected -t build lint test`
- Single project test: `pnpm nx test config`; single test: append `-- --testNamePattern="..."`
- Integration tests (need running infrastructure): `pnpm test:integration`
- Database: `pnpm db:generate` (new migration from schema), `pnpm db:migrate`, `pnpm db:seed`
- Local env: copy `.env.example` to `.env` (api/worker load it via dotenv; real env vars win)

## Non-negotiable rules

- TypeScript everywhere.
- No LangChain. No LlamaIndex.
- Use the official AI SDK Azure provider.
- All model deployments and limits come from validated (Zod) configuration.
- No document parsing inside an HTTP request handler.
- Files upload directly to object storage (browser → Blob Storage via short-lived scoped URLs); file contents never pass through the API process.
- Every persisted chunk must have a valid source locator.
- PDF locators contain page and normalized polygons.
- When XLSX support is implemented later, its locators must contain worksheet and exact cell range.
- Citation metadata comes from the database, never from the model.
- Reject unknown model citation IDs.
- Every factual answer segment needs evidence.
- Retrieval must filter by tenant, authorization, document scope and active versions. Document scope defaults to the whole tenant corpus; a conversation's explicit selection (conversation_documents rows) narrows it.
- PostgreSQL is the source of truth.
- Store normalized extraction output separately from embeddings.
- Ingestion must be retryable and idempotent (dequeue-count retries, visibility renewal, poison queue).
- Do not log document text, prompts, answers or embeddings by default.
- Enforce file, page, cell, token and request limits.
- Keep API, worker and web separately deployable.
- Keep domain logic outside NestJS controllers and React components.
- Prefer explicit code over framework-heavy abstractions.
- Do not add Azure AI Search, Document Intelligence, private endpoints, HA or always-running replicas during the POC.
- Use Docker Compose for local PostgreSQL and Azurite; run web, API and worker as host Nx processes locally.
- Keep Docker Compose limited to local infrastructure unless a later phase explicitly requires application-container smoke tests.
- Use explicit Bicep plus GitHub Actions for Azure deployment.
- Use GitHub OIDC for Azure authentication; no long-lived Azure credentials in GitHub secrets.
- Use Azure Container Registry Basic, not GitHub Container Registry.
- Use pnpm, one root package.json and exactly one root lock file. Target Node.js 22 LTS.
- No script may silently delete local data (`infra:reset` is the only volume-deleting command and must stay explicit).
- Do not add an Azure resource estimated above €15 per month without documenting its necessity and recalculating the complete budget.
- Preserve at least €20 monthly headroom below the €130 Azure budget.

## Architecture

Nx monorepo layout (target structure, per `docs/PLAN.md`):

- `apps/web` — UI composition only.
- `apps/api` — HTTP concerns and application orchestration; no domain logic in controllers.
- `apps/ingestion-worker` — consumes Azure Queue Storage messages (parse → normalize → persist artifact → chunk → embed → insert chunks → mark ready).
- `libs/contracts` — shared Zod schemas and API DTOs (no duplicate DTO definitions).
- `libs/config` — Zod-validated env loading (`loadApiEnv`/`loadWorkerEnv`, `normalizeDatabaseUrl`, `loadDotenv`).
- `libs/testing` — integration-test helpers; integration specs run via `test-integration` targets.
- `libs/database` — Drizzle schema (all PLAN §5 tables, pgvector + generated tsvector), migrations (`libs/database/migrations`), tenant-scoped repositories, idempotent seed. Chunks can never be inserted without a valid locator (enforced in `ChunkRepository`).
- `libs/domain`, `libs/storage`, `libs/queue`, `libs/retrieval`, `libs/ai` — added in later phases.
- `infra/azure` — explicit Bicep (Phase 8).

Do not add an abstraction unless it protects a known external boundary or has more than one expected implementation.

Key flows to understand before touching related code:

- **Upload:** API issues a scoped short-lived upload URL → browser uploads directly to Blob Storage → API verifies the object → creates ingestion job → sends queue message. Complete-upload is idempotent; queue message only after storage verification.
- **Answering:** rewrite follow-up → one query embedding → vector + full-text search → RRF fusion → mandatory filters (tenant, authorization, document scope, active version, not deleted) → ~6-10 chunks in token budget → model answers with opaque citation IDs → backend validates every citation against the retrieved set and resolves all citation metadata from the database. Document scope: whole tenant corpus by default; a conversation's explicit selection narrows it.

## Working process

Before implementing a phase:

1. Read `docs/PLAN.md` and this file.
2. Inspect only the code created by completed phases and summarize what is relevant.
3. Propose the smallest implementation for the current phase.
4. Do not start later phases.

After changes:

1. Run affected build, lint and tests.
2. Fix failures.
3. Prove the phase acceptance criteria.
4. Report cost and security impact.
5. List unresolved issues honestly.

## Code preferences

- Strict TypeScript.
- Zod at external boundaries.
- Shared contracts live in `libs/contracts`.
- Small modules and explicit names.
- No duplicate DTO definitions.
- No `any` without documented justification.
- No speculative abstractions.
- No silent fallback that weakens authorization, citation validation or data integrity.
- Comments explain why, not what.
