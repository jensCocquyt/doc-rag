# ADR 0002 — Docker Compose replaces the Aspire TypeScript AppHost

Date: 2026-07-20
Status: Accepted (supersedes the orchestration decision in ADR 0001)

## Context

Phase 0 used an Aspire 13.4 TypeScript AppHost for local orchestration and as the intended Azure deployment model. The revised plan (`docs/PLAN.md`, Phase 0A) standardizes on Docker Compose for local infrastructure and explicit Bicep + GitHub Actions for Azure deployment.

Observed friction with Aspire during Phase 0 supported the change:

- Extra toolchain requirement (Aspire CLI ≥13.2 with matching SDK) beyond Node/pnpm/Docker.
- Randomized proxied ports and a generated Postgres password made headless verification and standalone integration-test runs awkward.
- Connection strings were injected in ADO.NET form, requiring normalization for node-postgres.
- The generated `.aspire/` SDK and `aspire-apphost/` package added a second dependency tree outside the single root manifest.
- Deployment-by-Aspire would have generated infrastructure implicitly; the budget rules favor explicit, reviewable IaC.

## Decision

- A root `docker-compose.yml` runs local infrastructure only: `pgvector/pgvector:pg16` (PLAN.md Phase 0A pins PostgreSQL 16) and `mcr.microsoft.com/azure-storage/azurite:3.35.0`, both with named volumes, health checks, fixed ports (5432 / 10000 / 10001) and pinned image versions.
- Web, API and worker keep running as host Node processes through Nx (`pnpm dev`) for fast hot reload and simple debugging.
- Configuration comes from `.env` (dev) or real environment variables (CI/Azure), validated by `libs/config`. `loadDotenv` never overrides existing env vars; `normalizeDatabaseUrl` is retained because Azure connection strings commonly use the ADO.NET form.
- Root scripts: `infra:up`, `infra:down` (keeps data), `infra:logs`, `infra:reset` (the only volume-deleting command), `dev`.
- CI runs unit build/lint/test without Docker; the integration job starts Compose with `--wait`, prints Compose logs on failure and always tears down.
- Azure deployment (Phase 8) will use explicit Bicep + GitHub Actions with OIDC. Aspire is fully removed: no CLI requirement, no `aspire-apphost/`, no `aspire.config.json`.

## Consequences

- Local dev needs two commands (`pnpm infra:up`, `pnpm dev`) instead of one (`aspire run`); in exchange ports and credentials are deterministic and documented in `.env.example`.
- The Aspire dashboard (logs/traces UI) is gone; observability tooling arrives via OpenTelemetry in Phase 10.
- PostgreSQL moves from the pg17 image used in Phase 0 to pg16 per the updated plan; no data migration needed (fresh volumes).
- The Phase 8 deployment work described in ADR 0001 is superseded by Bicep modules under `infra/azure`.
