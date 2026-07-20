# ADR 0001 — Phase 0 foundation: Nx single-manifest monorepo with Aspire TypeScript AppHost

Date: 2026-07-20
Status: Accepted

## Context

`docs/PLAN.md` prescribes a production-oriented RAG POC: Nx monorepo (React web, NestJS/Fastify API, TypeScript ingestion worker), PostgreSQL + pgvector, Azure Blob/Queue Storage (Azurite locally), orchestrated by an Aspire TypeScript AppHost, within a €130/month Azure budget. Phase 0 delivers the scaffold and a working local environment.

## Decision

1. **Nx 23 workspace with a single root `package.json`** (`project.json` per project, no pnpm workspaces). One dependency version set, enforced Single Version Policy. Lib import aliases are scoped (`@doc-rag/contracts`, `@doc-rag/config`, `@doc-rag/testing`) via `tsconfig.base.json` paths.
2. **Aspire 13.4 TypeScript AppHost** (`aspire-apphost/apphost.mts`) is the only local orchestrator. It runs PostgreSQL (`pgvector/pgvector:pg17` image, named data volume) and Azurite (`runAsEmulator()`) as containers, and web/api/worker as local Node processes via root `dev:*` scripts (`nx serve …`) for hot reload. Connection strings are injected under explicit env names (`DATABASE_URL`, `AZURE_STORAGE_BLOB_CONNECTION_STRING`, `AZURE_STORAGE_QUEUE_CONNECTION_STRING`) — the same contract `libs/config` validates with Zod. No Docker Compose.
3. **PostgreSQL 17** (not 16 as PLAN.md suggests): the maintained pgvector image tracks pg17 and Azure Database for PostgreSQL Flexible Server supports it. Revisit only if an Azure region constraint appears in Phase 8.
4. **Vitest everywhere.** `@nx/nest`/`@nx/node` default to Jest, so api/worker test wiring is manual (integration specs run through dedicated `test-integration` targets with `vitest.integration.config.mts`). Unit `nx test` stays hermetic; integration tests skip when the environment is absent and run against live services (aspire run locally, service containers in CI).
5. **Both Node apps build with webpack (`NxAppWebpackPlugin`, `compiler: tsc`)**. The `@nx/esbuild` executor synthesizes a tsconfig that drops project references, which conflicts with the workspace's composite TypeScript setup; webpack handles it and keeps api/worker builds identical.
6. **CI now (GitHub Actions)**: affected lint/test/build plus an integration job with `pgvector/pgvector:pg17` and Azurite service containers. No Azure resources, credentials, or deployment until Phase 8.

## Deviations from PLAN.md

- `aspire-apphost/` keeps its own Aspire-owned `package.json` (CLI requirement); all product code uses the root manifest.
- Root `aspire.config.json` is committed; the generated `.aspire/` SDK is gitignored per Aspire guidance.
- PostgreSQL 17 instead of 16 (see above).
- CI workflow added in Phase 0 instead of Phase 8 (validation only, zero cost impact).

## Consequences

- `aspire run` is the single entry point for local development; `pnpm nx run-many -t build lint test` gates changes.
- Per-library declaration outputs (`libs/*/out-tsc`) keep composite project references working; `nx sync` maintains reference lists and runs as a CI check.
- Phase 1 (Drizzle schemas, migrations, repositories) builds on `libs/config` env validation and the `docrag` database resource without re-scaffolding.
