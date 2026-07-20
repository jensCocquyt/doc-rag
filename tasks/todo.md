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
