# Phase 10 — Hardening, observability, evaluation (feat/phase-10-hardening)

- [x] Rate limiting: @fastify/rate-limit 300/min per client + per-user
      sliding-hour chat quota (CHAT_REQUESTS_PER_USER_PER_HOUR, 429
      chat_quota_exceeded). Verified by integration test AND load probe
      (4037 req/s, 0 failures, p99 16ms, limiter engages).
- [x] Request-size cap (MAX_REQUEST_BODY_BYTES, 413) — extracted
      http-hardening.ts shared by bootstrap and tests.
- [x] Correlation ids: uuid per request, echoed as x-request-id.
- [x] Worker: PDF magic-bytes check before parsing (invalid_file_signature);
      richer ingestion metrics log (pages/elements/chunks/~tokens/duration).
- [x] Prompt-injection defense: system prompt marks evidence as untrusted
      data whose embedded instructions must never be followed.
- [x] Scripts: pnpm reindex (rebuild chunks from normalized artifacts, skips
      cited chunks to preserve answer provenance — found the FK constraint
      the hard way), pnpm cleanup:blobs (dry-run default, --apply),
      pnpm load-test.
- [x] Runbooks: docs/operations/runbooks.md (failed ingestion, queue/model
      outage, backup/restore, reindex, delete+cleanup, cost investigation).
- [x] Eval extended: unanswerable questions + latency; refusal reporting
      with honest caveat (real refusal quality needs real embeddings).
- [x] Tests: 3 hardening integration tests (correlation header, 413, 429);
      magic-bytes worker test. 56 integration tests green overall.
- Known: chat quota is in-memory (single-replica POC); OTel tracing not
  wired (config flag exists, App Insights connection string provisioned in
  Bicep); answer faithfulness/completeness metrics need a real model.

# Phase 9 — Entra auth, CODE ONLY (feat/phase-9-entra-auth)

- [x] libs/auth: EntraTokenVerifier (jose, tenant JWKS, issuer/audience/
      lifetime) with injectable key resolver; 7 unit tests via local JWKS
      (wrong audience/issuer/expiry/unknown key/missing tid/garbage).
- [x] API: global AuthGuard behind explicit AUTH_MODE=poc|entra (poc default,
      never a silent fallback — entra without settings fails startup);
      @Identity() per-request identity threaded through ALL documents +
      conversations services/controllers (POC constants removed from
      services); /health stays @Public for probes; first-login user
      provisioning via users.external_identity_id.
- [x] CoreModule (@Global): single pg pool + env + repositories for the app.
- [x] audit_events table (migration 0003) + repository: upload/delete/
      conversation-create/chat-request/auth-failure, ids + outcomes only.
- [x] Web: MSAL (@azure/msal-browser) behind VITE_AUTH_MODE=entra; apiFetch
      attaches Bearer tokens; poc default unchanged. docs/entra-setup.md has
      the registration steps.
- [x] Tests: 5 auth integration tests (401 unauthenticated + audit row,
      forged token 401, public health, valid token provisioning without
      duplicates, cross-tenant IDOR 404 for document + preview). 20 API
      integration tests green.
- Fixed: circular import auth.module↔auth.guard left the DI symbol undefined
  → extracted tokens.ts.
- NOT done by design: no real Entra app registrations (Jens's decision);
  per-user document ACLs out of POC scope (tenant-wide access model).

# Phase 8 — Azure IaC + deploy pipeline, CODE ONLY (feat/phase-8-azure-deploy)

- [x] infra/azure: main.bicep + modules (storage w/ CORS+lifecycle+queues, ACR
      Basic, Log Analytics 30d/0.5GB-cap + App Insights 25% sampling, Postgres
      B1ms/32GB/no-HA/VECTOR, optional Azure OpenAI gpt-4o-mini +
      text-embedding-3-small, Container Apps env + 3 apps min=0 with KEDA
      azure-queue rule for worker, user-assigned identity + AcrPull, RG-scope
      budget 62/77/92% of €130). Compiles clean with az bicep build; CI step
      validates on every PR.
- [x] Dockerfiles: api/worker (node:22-alpine multi-stage, pruned manifest +
      pnpm install, non-root, +tslib workaround for Nx manifest omission),
      web (nginx-unprivileged, env-templated proxy for /documents|
      /conversations|/health → API, no CORS surface). All three built AND
      smoke-tested against local infra (health all-up; worker consuming;
      web serves shell).
- [x] deploy.yml: workflow_dispatch only, OIDC login, quality gates, bicep
      validate + what-if + deploy, az acr build ×3, migrations + seed, health
      smoke loop. infra/azure/README.md has the one-time OIDC setup.
- NOT done by design (Jens's decision): no Azure resources created, nothing
  deployed, no OIDC app registration. Azure acceptance criteria (reachable
  stack, scale-from-zero test) are pending the user's first dispatch run.

# Phase 6 — React UI + PDF viewer + e2e (feat/phase-6-react-ui)

- [x] API additions: GET /documents/:id/preview-url, POST /documents/:id/retry
      (requeue + resend, fixes lost-message stranding), polygons on CitationDto.
- [x] Web: app shell (TanStack Query + routes), documents page retry button,
      chat page (conversation list, scope selector, NDJSON streaming with pure
      reducer, markdown, citation chips, stop/regenerate, states), lazy
      react-pdf viewer with normalized-polygon highlights + excerpt.
- [x] pdfjs-dist pinned to react-pdf's version (5.4.296); worker+viewer aligned.
- [x] Fixed: nx project named 'ai' shadowed npm 'ai' package in the serve
      executor's require overrides → renamed project to 'ai-lib'.
- [x] Playwright e2e (apps/web-e2e): full happy path passes locally in real
      Chromium — upload → ready → conversation → scope → streamed cited answer
      → citation opens page 2 with highlight. CI e2e job added.
- Known: viewer renders one page (no free scrolling); citation switching =
  clicking another chip; fake answers are extractive.

# Phase 5 — Streamed chat + validated citations (feat/phase-5-streamed-chat)

- [x] libs/ai: AnswerGenerator/QueryRewriter/Summarizer interfaces; Azure impls
      (AI SDK streamObject/generateText) + grounded deterministic fakes;
      mapAnswerPartials pure mapper unit-tested.
- [x] Contracts: conversation/message DTOs, NDJSON chat stream events,
      modelAnswerSchema (segments + insufficientEvidence).
- [x] DB: conversation + message repositories; messages.metadata migration
      (segments, latencies, error codes — never content beyond the answer).
- [x] API: conversations module — CRUD, PATCH documents (validated selection),
      NDJSON streamed POST message, retry/regenerate, cancel via generationId,
      client-disconnect abort, history summarization past
      CONVERSATION_RECENT_MESSAGES.
- [x] Validation: unknown citation id → citation_validation_failed; factual
      segments must cite; citations resolved from DB only.
- [x] Tests: 7 API integration (typed cited stream, persistence, scoping,
      insufficient evidence, hostile-model rejection via DI override, cancel
      endpoint, regenerate) + ai lib units. 15 projects green.
- Known: rate limiting deferred to Phase 10; Azure generator untested against
  a live deployment (no credentials); cost estimate uses fixed POC rates.

# Phase 4 — PostgreSQL hybrid retrieval (branch feat/phase-4-hybrid-retrieval, own PR)

- [x] libs/retrieval: RRF fusion (k=60, weighted arms), exact-identifier arm,
      mandatory filters in every arm's SQL, neighbour dedup + token budget.
- [x] Config: RETRIEVAL_*_TOP_K, MAX_CONTEXT_TOKENS.
- [x] Eval harness tools/eval (`pnpm eval`): 7 questions, isolated tenant,
      reports hit rate and citation-page correctness separately. 7/7 + 7/7
      with fake embeddings (lexical + verbatim arms honest; semantic recall
      needs AI_PROVIDER=azure).
- [x] Tests: fusion/assembly unit; 9 integration tests incl. tenant isolation,
      selection narrowing, active-version + soft-delete exclusion, EXPLAIN
      index proof (enable_seqscan=off for tiny tables).
- Known: userId reserved (per-user authz is Phase 9); citation ids assigned
  at retrieval time (Phase 5 persists mapping).

# Phase 3 — PDF ingestion (same branch/PR as Phase 2, per Jens)

## Plan

- [x] Deps: `pdfjs-dist`, `ai`, `@ai-sdk/azure`; dev `pdf-lib` (test fixture PDFs).
- [x] `libs/document-processing`: `NormalizedDocumentElement`, `PdfSourceLocation`,
      `DocumentParser` interface, MIME-keyed `ParserRegistry`.
- [x] `libs/pdf-processing`: pdfjs-based parser — pages, text order, normalized
      (0..1) polygons, page dims, font-size heading heuristic. Golden tests with
      pdf-lib-generated fixtures.
- [x] `libs/chunking`: deterministic chunker — ~650-token target (chars/4
      approximation), never crosses pages, heading context trail, overlap only
      when splitting long runs, sha256 content hashes.
- [x] `libs/embeddings`: `EmbeddingService`; `AzureOpenAiEmbeddingService`
      (AI SDK `embedMany`, batched) + `DeterministicEmbeddingService`
      (explicit `AI_PROVIDER=fake` for local/CI — never a silent fallback).
- [x] `libs/queue`: consumer with visibility renewal, dequeue-count retries
      with backoff, poison-queue move. Azurite integration tests.
- [x] `libs/storage`: add server-side `writeObject` (normalized artifact
      persistence from the worker).
- [x] `libs/config`: worker env — artifacts container, poison queue, visibility/
      dequeue settings, chunk/embedding settings, AI_PROVIDER (+ conditional
      AZURE_OPENAI_* requirements).
- [x] `libs/database`: job findById/markProcessing/markSucceeded/markFailed;
      version findById/updateParseResult; document setContentHash.
- [x] `apps/ingestion-worker`: pipeline — decode → load → processing → read blob
      → limits → parse → persist normalized artifact → chunk → embed → wipe +
      insert chunks → ready; idempotent replays; poison marks document failed.
      Integration tests incl. retry/idempotency and 100-page PDF.
- [x] Verify: pnpm check + typecheck + test:integration; browser E2E:
      upload PDF → status ready (fake embeddings).

## Phase 3 review

- 13 projects green on build/lint/test/typecheck; 32 integration tests pass
  (queue retry/poison, worker pipeline incl. 100-page PDF in ~0.8 s).
- Browser E2E: uploaded PDF went uploading → queued → processing → ready with
  all three apps running; Jens's real 13-page PDF produced 17 chunks with
  heading contexts, page locators, per-line polygons and embeddings; a fake
  "PDF" (zeros) failed permanently with parse_failed. Backlog messages from
  Phase 2 were consumed correctly on worker start (durable handoff proven).
- Fixed along the way: Phase 2's API integration test drained the shared dev
  queue (stranding real queued documents) — now uses an isolated per-run queue
  and cleans up its document rows. Stranded dev documents repaired by
  re-enqueueing.
- Known limitations: no /documents/:id/retry endpoint yet (a lost queue
  message strands a 'queued' document until re-enqueued); scanned PDFs
  rejected (no_text_content, no OCR by design); token counts are chars/4;
  heading detection is font-size heuristic only; document DTO does not expose
  the job's internal error code.

## Decisions

- Token counts are a chars/4 approximation (no tokenizer dependency in POC);
  revisit when real evaluation lands (Phase 4+).
- Normalized artifact JSON goes to a separate `artifacts` container keyed
  `.../versions/{n}/normalized.json`; chunks are rebuildable from it.
- Retry model: wipe-and-rewrite chunks per version before insert (unique
  (version, sequence) index is the second guard).
- Transient failure → job back to `queued` + error recorded, message redelivered
  by visibility timeout; dequeueCount ≥ max → poison queue + job `poisoned` +
  document `failed`.

# Phase 2 — Blob Storage abstraction and direct upload

Branch: `feat/phase-2-storage-upload`

## Plan

- [x] `libs/storage` (new): `ObjectStorage` interface + `AzureBlobObjectStorage`
      (SAS-scoped upload target, verify, read stream, preview target, delete;
      dev-only Azurite CORS helper). Integration tests against Azurite incl.
      SAS scoping, expiry, 100 MB smoke.
- [x] `libs/config`: extend API env — originals container, ingestion queue name,
      MAX_FILE_SIZE_BYTES, UPLOAD_URL_TTL_SECONDS, PREVIEW_URL_TTL_SECONDS.
- [x] `libs/contracts`: upload-session request/response, document DTO,
      complete-upload response, ingestion queue message schema (+ base64
      encode/decode helpers). Unit tests.
- [x] `libs/database`: POC tenant/user constants moved to lib; new
      DocumentVersionRepository + IngestionJobRepository (idempotent create);
      DocumentRepository.setActiveVersion.
- [x] `apps/api`: DocumentsModule — POST /documents/upload-sessions,
      POST /documents/:id/complete-upload (idempotent, verify-before-queue),
      GET /documents, GET /documents/:id, DELETE /documents/:id (soft).
      Queue message sent only after storage verification. Integration tests
      via app.inject.
- [x] `apps/web`: minimal documents page — multi-file picker, direct XHR PUT
      to SAS URL with progress, complete-upload call, list + status polling,
      delete. Vite proxy /documents → API. No new deps.
- [x] Docs: .env.example, CLAUDE.md (libs/storage exists).
- [x] Verify: pnpm check, typecheck, test:integration, browser 100 MB upload.

## Decisions

- SAS URL is scoped to one exact server-generated blob name (create+write only)
  → client cannot choose storage keys.
- Storage key: `tenants/{tenantId}/documents/{documentId}/versions/{n}/original.pdf`.
- Ingestion job idempotency key = document version id (unique index) →
  repeated complete-upload cannot duplicate jobs; duplicate queue deliveries
  are tolerated (worker is idempotent by design in Phase 3).
- Queue message is base64(JSON), schema + codec shared in contracts.
- Soft delete keeps the blob (lifecycle cleanup is a later phase).
- Content hashing deferred to the worker (file bytes never touch the API).
- No global /api prefix yet; Vite dev proxy forwards /documents and /health.
- Azurite CORS is set best-effort at API bootstrap in development only; Azure
  storage-account CORS belongs to Bicep in Phase 8.

## Review

- All checks green: `pnpm check` (build/lint/test, 8 projects), `typecheck`,
  `pnpm test:integration` (storage 4, api 8 incl. 6 new documents tests,
  database, testing).
- Browser-verified: 100 MB synthetic PDF uploaded from the real page at
  localhost:4200 → CORS preflight + PUT direct to Azurite :10000 (SAS `sp=cw`,
  exact blob path), complete-upload → status `queued`; queue message decoded
  and matched job/version ids in the integration test. API node process at
  ~86 MB working set after the 100 MB upload.
- Known limitations: no retry endpoint yet (Phase 3), preview endpoint not
  exposed over HTTP (lib support only), duplicate queue message possible on
  concurrent complete-upload (worker idempotency handles it), stuck
  `uploading` rows have no janitor/expiry yet.
