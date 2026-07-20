# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Project: Document Chat RAG

Production-oriented RAG POC with a hard Azure budget of €130 per month.

**Current state:** Phase 0 (Nx workspace, apps, libs, health checks, CI), Phase 0A (Docker Compose replaced Aspire), Phase 1 (Drizzle schema, migrations, repositories, seed), Phase 2 (Blob storage abstraction, direct browser→Azurite upload, document endpoints) Phase 3 (PDF ingestion pipeline: parse → normalize → artifact → chunk → embed → ready, with retries and poison queue) Phase 4 (hybrid retrieval + eval harness), Phase 5 (streamed chat with backend-validated citations) and Phase 6 (React document library + chat UI + react-pdf citation viewer with polygon highlights, retry + preview endpoints, Playwright e2e happy path) are complete. The full PLAN §15 vertical slice works end to end locally with AI_PROVIDER=fake. The full build plan, phased implementation guide, domain model, API outline and acceptance criteria live in `docs/PLAN.md`. Read it before implementing anything. Implement one phase per session; do not expand scope beyond the current phase. Architecture decisions are recorded in `docs/decisions/`.

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
- `libs/storage` — `ObjectStorage` boundary + `AzureBlobObjectStorage` (SAS upload/preview URLs scoped to one server-chosen blob name, verify, read stream, server-side artifact write, delete; dev-only Azurite CORS helper). File bytes never pass through the API.
- `libs/document-processing` — `NormalizedDocumentElement` model (PLAN §7), `DocumentParser` interface, MIME-keyed `ParserRegistry`.
- `libs/pdf-processing` — pdfjs-dist text extraction: pages, reading order, normalized 0..1 top-left polygons, font-size heading heuristic. Parser copies its input (pdfjs detaches buffers).
- `libs/chunking` — deterministic chunker (never crosses pages, heading context, overlap only when splitting long runs, sha256 hashes). Token counts are a chars/4 approximation.
- `libs/embeddings` — `EmbeddingService`: Azure OpenAI via AI SDK `embedMany` (batched) or `DeterministicEmbeddingService` behind explicit `AI_PROVIDER=fake` (local/CI without credentials; never a silent fallback).
- `libs/queue` — `QueueConsumer`: visibility renewal at half-timeout, dequeue-count retries with exponential backoff, poison-queue move + `onPoison` callback. At-least-once; handlers must be idempotent.
- `libs/retrieval` — hybrid retrieval (PLAN §8): vector + full-text + exact-identifier arms with RRF fusion, mandatory filters (tenant/scope/active-version/ready/not-deleted) in every arm's SQL, neighbour dedup and token-budgeted context assembly. Eval harness: `pnpm eval` (tools/eval; needs running infra).
- `libs/ai` — provider-independent `AnswerGenerator`/`QueryRewriter`/`ConversationSummarizer`: Azure OpenAI via AI SDK `streamObject`/`generateText`, or grounded deterministic fakes behind `AI_PROVIDER=fake`. The model only ever sees opaque citation ids; `mapAnswerPartials` converts partial objects to streaming events (pure, unit-tested).
- `libs/domain` — added in later phases (may never be needed; domain logic lives in feature libs).
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

## Workspace gotchas (learned in Phases 0-1; save yourself the debugging)

Adding a new library (`pnpm nx g @nx/js:library libs/<name> --bundler=none --linter=eslint --unitTestRunner=vitest --useProjectJson=true`) requires four manual fixes afterwards, because the generators predate this workspace's conventions:

1. `tsconfig.base.json`: rename the generated bare path alias to `@doc-rag/<name>`.
2. `libs/<name>/tsconfig.json`: delete the `"module": "commonjs"` override (conflicts with the base `moduleResolution: nodenext` under TS 6).
3. `libs/<name>/tsconfig.lib.json` and `tsconfig.spec.json`: set `outDir` to `./out-tsc/lib` and `./out-tsc/spec` — the generated shared `../../dist/out-tsc` makes libs overwrite each other's declaration files, producing phantom "has no exported member" errors.
4. `libs/<name>/tsconfig.spec.json`: add `"references": [{ "path": "./tsconfig.lib.json" }]` or specs importing lib sources fail typecheck with TS6307.

Also: run `pnpm nx sync` after adding cross-project imports; integration specs are named `*.integration.spec.ts` with their own `vitest.integration.config.mts` + `test-integration` run-commands target (copy an existing lib's pattern), and must be excluded in the unit `vitest.config.mts`.

Other quirks:

- Node apps build with webpack (`NxAppWebpackPlugin`, see `apps/*/webpack.config.js`) — the `@nx/esbuild` executor drops TypeScript project references and fails on composite imports (ADR 0002).
- Nx injects the root `.env` into every task's environment. Never put `PORT` in `.env` (it would repoint the Vite dev server); the API's port defaults in `libs/config`.
- Azurite runs with `--skipApiVersionCheck` (pinned image predates the Azure SDK's API version). When bumping `@azure/storage-*`, keep it.
- Never name an Nx project the same as an npm dependency (the lib at `libs/ai` is project `ai-lib`): the `@nx/js:node` serve executor's require overrides resolve workspace project names before node_modules, shadowing the real package.
- `pdfjs-dist` is pinned to react-pdf's bundled version (see package.json) so the viewer worker and parser use one version; check react-pdf's dependency before bumping.
- apps/web compiles with `moduleResolution: bundler` (Vite); Node apps/libs stay on the workspace `nodenext` default.
- `DATABASE_URL` may arrive in ADO.NET form in Azure; `normalizeDatabaseUrl` in `libs/config` converts it — use it wherever a pg connection is opened from raw env.
- Windows dev machine: prefer the repo's pnpm scripts; kill orphaned dev servers by matching `serve|vite|node-with-require-overrides` in the node process command lines.

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
