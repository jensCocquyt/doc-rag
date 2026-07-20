# Document Chat RAG - Claude Code Build Plan

Production-oriented RAG POC constrained to an Azure budget of **€130 per month**.

Core stack:

- React + TypeScript
- NestJS with the Fastify adapter
- Separate TypeScript ingestion worker
- PostgreSQL + pgvector
- Azure Queue Storage
- Azurite locally
- Docker Compose for local infrastructure
- Vercel AI SDK with Azure OpenAI
- Nx monorepo
- Azure Container Apps

The architecture includes the production seams needed for:

- Direct-to-storage uploads
- Large PDF and XLSX files
- Exact PDF and spreadsheet citations
- Azure Blob Storage
- Microsoft Entra ID
- Tenant isolation
- Cost monitoring and hard budget controls

Do not implement everything at once. Complete one phase per Claude Code session where practical.

## Greenfield repository assumptions

This plan will be added to a completely empty GitHub repository.

Bootstrap choices:

- Package manager: `pnpm`.
- Runtime: Node.js 22 LTS.
- Monorepo: one root `package.json` managed by Nx.
- Source control: GitHub.
- CI/CD: GitHub Actions.
- Default branch: `main`.
- Development model: short-lived feature branches and pull requests.
- Unit and integration tests: Vitest.
- Browser end-to-end tests: Playwright.
- Database migrations and access: Drizzle ORM.
- Local infrastructure orchestration: Docker Compose.
- Azure deployment model: explicit Bicep plus GitHub Actions.
- Container image registry: Azure Container Registry Basic.

Phase 0 has already created the repository foundation. Phase 0A must now replace Aspire with Docker Compose while preserving the working Nx applications, libraries, tests and GitHub validation.

---

## Docker Compose scope decision

Docker Compose manages local infrastructure only. Web, API and worker run directly through Nx.

This gives:

- Fast hot reload.
- Straightforward Node debugging.
- No application image rebuilds during normal development.
- A small Compose file focused on stateful dependencies.

A later production-like Compose smoke-test file may containerize the applications, but it is not part of Phase 0A.

---

## 1. Goal

Build a POC where a user can:

1. Upload multiple PDF files in the initial implementation.
2. Process small and large PDF files asynchronously.
3. Ask questions across the tenant's entire document corpus by default, optionally narrowing a conversation to one or more selected files.
4. Ask questions about those files.
5. Receive streamed answers.
6. See inline citations for factual claims.
7. Open a cited PDF at the correct page with highlighted text.
8. Deploy the application to Azure.
9. Keep recurring Azure costs below **€130 per month**.

XLSX support is a later extension and is not part of the initial implementation.

The first usable milestone is deliberately PDF-only:

1. Upload one text-based PDF.
2. Process it asynchronously.
3. Ask one question.
4. Receive a streamed answer.
5. Click a citation.
6. Open the correct page with a visible highlight.

---

## 2. Architecture decision

### Frontend

- React
- TypeScript
- Vite
- TanStack Query
- Vercel AI SDK React integration
- React Router
- PDF.js through `react-pdf`
- TanStack Virtual for large read-only spreadsheet views
- Markdown rendering with HTML disabled or sanitized
- Shared Zod contracts from the Nx workspace

### API

- Node.js
- TypeScript
- NestJS
- NestJS Fastify adapter
- OpenAPI
- Zod for shared request and response contracts
- Server-Sent Events or AI SDK streaming responses
- Drizzle ORM
- PostgreSQL

### Worker

- Separate Node.js and TypeScript application
- Azure Queue Storage SDK
- Queue polling with configurable visibility timeout
- Retry based on dequeue count
- Dedicated poison queue
- Pluggable document parser registry
- Local PDF parser first
- Batched embedding generation
- Retryable and idempotent ingestion

### Retrieval

- PostgreSQL full-text search
- pgvector
- Reciprocal rank fusion
- Metadata filtering
- No Azure AI Search during the POC

### Storage

Local:

- Azurite for Blob Storage and Queue Storage
- Docker Compose manages the Azurite container; connection information comes from validated local configuration
- Browser uploads directly to Blob Storage using short-lived scoped URLs

Azure:

- Azure Blob Storage for original files and extracted artifacts
- Azure Queue Storage for ingestion messages
- Short-lived SAS upload URLs

Files must not pass through the API process in the final POC architecture.

### AI

- Vercel AI SDK Core
- Official Azure provider package
- Azure OpenAI
- Small embedding model by default
- Small chat model by default
- Deployment names and model configuration supplied through environment variables

Suggested starting deployments, subject to regional availability:

- Chat: a small model such as GPT-4.1 mini or GPT-4o mini
- Embeddings: `text-embedding-3-small`

No LangChain or LlamaIndex.

### Local orchestration and Azure hosting

- Docker Compose for local infrastructure
- Local Node processes for web, API and worker with hot reload
- Aspire-managed containers for PostgreSQL with pgvector and Azurite
- Aspire Dashboard for logs, traces, health and endpoints
- Azure Container Apps Consumption
- Azure Database for PostgreSQL Flexible Server
- Azure Blob Storage and Queue Storage
- Azure Container Registry Basic
- Azure OpenAI
- Application Insights and Log Analytics
- Managed identities where supported
- GitHub repository and GitHub Actions
- GitHub OIDC for Azure authentication

Do not use GitHub Container Registry for this deployment. Container images are stored in Azure Container Registry.

## 3. Azure budget contract

The whole Azure environment must stay below **€130 per month**.

### Expected monthly POC allocation

| Resource                      |      Target |
| ----------------------------- | ----------: |
| PostgreSQL Flexible Server    |     €20-€35 |
| Container Apps                |      €0-€15 |
| Blob Storage and transactions |       €1-€5 |
| Azure Container Registry      |       €4-€6 |
| Azure OpenAI                  |      €5-€20 |
| Monitoring and logs           |      €0-€10 |
| Safety buffer                 |     €20-€35 |
| **Expected total**            | **€30-€70** |
| **Hard maximum**              |    **€130** |

Pricing varies by region, agreement and exchange rate. Validate the final resources in the Azure Pricing Calculator before deployment.

### Mandatory budget controls

- Create Azure Cost Management alerts at:
  - €80 forecasted or actual
  - €100 forecasted or actual
  - €120 forecasted or actual
- Tag every resource with:
  - `project=document-chat-rag`
  - `environment=poc`
  - `owner=jens`
  - `cost-center=personal-azure-credit`
- Do not create:
  - Azure AI Search
  - Document Intelligence
  - Private endpoints
  - NAT Gateway
  - Application Gateway
  - Front Door
  - Database high availability
  - Provisioned model throughput
  - Always-running worker replicas
- Container Apps:
  - API minimum replicas: `0`
  - Worker minimum replicas: `0`
  - Frontend minimum replicas: `0`
  - Maximum replicas: low and explicit
- PostgreSQL:
  - Use a burstable POC SKU.
  - Start with 32 GB storage or the smallest practical allocation.
  - Do not enable HA.
  - Set backup retention to the lowest acceptable POC value.
  - Stop the server manually when the environment will not be used for extended periods.
- Monitoring:
  - Do not log prompts, document text, answers or embeddings by default.
  - Add sampling.
  - Set a low daily ingestion cap.
  - Use short retention for the POC.
- Blob Storage:
  - Use lifecycle rules for deleted files and stale intermediate artifacts.
- AI:
  - Set token caps.
  - Set per-user and per-tenant quotas.
  - Log token usage and estimated cost.
  - Refuse requests that would exceed configured limits.

### Budget stop rule

Claude Code must not add an Azure resource with an estimated recurring cost above **€15 per month** without:

1. Documenting why the resource is required.
2. Listing a cheaper alternative.
3. Recalculating the monthly total.
4. Keeping at least a €20 safety buffer below the €130 budget.

---

## 4. Repository structure

Use an Nx monorepo.

```text
apps/
  web/
  api/
  ingestion-worker/

libs/
  contracts/
  config/
  domain/
  auth/
  database/
  storage/
  queue/
  document-processing/
  pdf-processing/
  spreadsheet-processing/
  chunking/
  embeddings/
  retrieval/
  ai/
  observability/
  testing/

tools/
  eval/
  scripts/

infra/
  azure/

docs/
  architecture/
  operations/
  decisions/

docker-compose.yml
```

### Responsibility rules

- `apps/web` contains UI composition only.
- `apps/api` contains HTTP concerns and application orchestration.
- `apps/ingestion-worker` consumes Azure Queue Storage messages.
- `libs/domain` contains framework-independent domain types and rules.
- `libs/contracts` contains shared Zod schemas and API DTOs.
- `libs/database` owns Drizzle schemas, migrations and repositories.
- `libs/storage` owns Blob Storage access using Azurite locally and Azure Blob Storage in Azure.
- `libs/queue` owns Azure Queue Storage clients, message contracts, retries and poison-message handling.
- `docker-compose.yml` owns local PostgreSQL and Azurite orchestration.
- `infra/azure` owns explicit Bicep for Azure infrastructure.
- `libs/retrieval` owns hybrid retrieval and context assembly.
- `libs/ai` owns model provider configuration and answer generation.
- No domain logic inside controllers.
- Do not add an abstraction unless it protects a known external boundary or has more than one expected implementation.

---

## 5. Core domain model

### Tenant

```text
id
name
createdAt
modifiedAt
```

For unauthenticated POC phases, seed one fixed tenant.

### User

```text
id
tenantId
externalIdentityId
email
displayName
createdAt
modifiedAt
```

### Document

```text
id
tenantId
fileName
mimeType
sizeBytes
contentHash
status
activeVersionId
createdByUserId
createdAt
modifiedAt
deletedAt
```

Statuses:

```text
uploading
uploaded
queued
processing
ready
failed
deleting
deleted
```

### DocumentVersion

```text
id
documentId
versionNumber
storageKey
contentHash
parserVersion
normalizedArtifactKey
pageCount
worksheetCount
createdAt
```

### IngestionJob

```text
id
documentVersionId
idempotencyKey
status
attempt
errorCode
errorMessage
startedAt
completedAt
createdAt
```

### Chunk

```text
id
tenantId
documentId
documentVersionId
sequence
content
contentHash
tokenCount
embedding
searchVector
headingContext
locator
metadata
createdAt
```

The `locator` field starts with a PDF locator. It may become a discriminated JSON union when additional file types are added.

PDF:

```json
{
  "type": "pdf",
  "page": 12,
  "polygons": [[0.12, 0.22, 0.74, 0.22, 0.74, 0.31, 0.12, 0.31]],
  "excerpt": "..."
}
```

No chunk may be persisted without a valid locator.

### Conversation

```text
id
tenantId
userId
title
summary
createdAt
modifiedAt
deletedAt
```

### ConversationDocument

```text
conversationId
documentId
```

### Message

```text
id
conversationId
role
content
status
model
inputTokens
outputTokens
estimatedCost
createdAt
```

### MessageCitation

```text
messageId
chunkId
citationNumber
```

---

## 6. Upload workflow

The upload flow uses Blob Storage locally and in Azure. Azurite emulates Blob Storage locally.

1. Web requests an upload session.
2. API validates metadata and creates the document record.
3. API creates a short-lived, narrowly scoped upload URL.
4. Browser uploads directly to Blob Storage.
5. Browser confirms completion.
6. API verifies the object exists and has an acceptable size.
7. API calculates or schedules content hashing.
8. API creates the ingestion job record.
9. API sends an ingestion message to Azure Queue Storage.
10. Worker receives and processes the message.
11. Web polls document status.

Required safeguards:

- File extension allowlist.
- MIME validation.
- Maximum file size.
- Maximum PDF pages.
- Upload URL expires quickly.
- Upload URL can write only one expected object.
- API does not accept arbitrary storage keys from the client.
- Duplicate confirmation calls are idempotent.
- Duplicate queue deliveries do not create duplicate chunks.
- Queue visibility timeout is renewed for long-running work.
- Messages exceeding the retry limit move to a poison queue.

## 7. Normalized document model

Parsers must produce normalized elements before chunking.

```ts
type SourceLocation = PdfSourceLocation | XlsxSourceLocation;

interface NormalizedDocumentElement {
  id: string;
  type: 'heading' | 'paragraph' | 'table' | 'spreadsheet-range';
  text: string;
  location: SourceLocation;
  metadata: Record<string, unknown>;
}
```

Store normalized extraction output separately from embeddings.

Benefits:

- Reindex without reparsing.
- Change embedding models without reparsing.
- Improve chunking without rerunning PDF extraction.
- Debug citations independently of retrieval.
- Add Azure Document Intelligence later without changing chunk storage.

---

## 8. Retrieval and answer rules

### Hybrid retrieval

Use one retrieval service that:

1. Rewrites follow-up questions when needed.
2. Generates one query embedding.
3. Runs vector search.
4. Runs PostgreSQL full-text search.
5. Combines rankings with reciprocal rank fusion.
6. Filters by:
   - Tenant
   - User authorization
   - Document scope: all tenant documents by default; only the selected document IDs when the conversation has an explicit selection
   - Active document version
   - Non-deleted status
7. Retrieves approximately 20 candidates.
8. Deduplicates nearby chunks.
9. Selects approximately 6 to 10 chunks within a token budget.
10. Returns evidence with opaque citation IDs.

### Answer generation

The model receives:

- The standalone question.
- Numbered source chunks.
- Opaque citation IDs.
- A strict instruction to use only supplied evidence.

The model must not create file names, page numbers or worksheet ranges.

The backend resolves all citation metadata.

Use structured output where feasible:

```json
{
  "segments": [
    {
      "text": "Revenue increased by 12 percent.",
      "citationIds": ["citation-3"]
    }
  ],
  "insufficientEvidence": false
}
```

Validate:

- Every citation ID was supplied in the model context.
- Every factual answer segment has a citation.
- Unknown citation IDs are rejected.
- Weak evidence produces an insufficient-information answer.
- Citation file, page and range data come from stored metadata.

---

## 9. How to use Claude Code

### Session pattern

Run one phase per Claude Code session where practical.

Start each session with:

```text
Read PLAN.md and CLAUDE.md.

This repository started as greenfield and Phase 0 has already been implemented with Aspire.
The next task is Phase 0A, which replaces Aspire with Docker Compose without starting Phase 1.

For Phase 0A, first inspect the implemented Phase 0 and identify every Aspire-specific file, dependency, script, workflow step, environment assumption and documentation reference.
Then propose the smallest safe migration to Docker Compose while preserving working Nx applications, libraries, tests and GitHub validation.
For later phases, inspect only the code created by completed phases and summarize what is relevant.
Then propose the smallest approach that satisfies the current phase acceptance criteria.
Do not write code until the approach is clear.
After implementation, run all required checks and prove each acceptance criterion.
Do not begin the next phase.
```

After each phase:

1. Review the diff.
2. Run tests.
3. Commit.
4. Start a fresh Claude Code session or run `/clear`.

Do not let Claude Code silently expand scope.

---

# Implementation phases

## Phase 0 - Greenfield repository bootstrap

### Status

Implemented.

The repository, Nx workspace, React application, NestJS API, ingestion worker, shared libraries, tests and GitHub validation workflow already exist.

Some Phase 0 work was implemented around Aspire and must now be adjusted in Phase 0A.

Do not recreate the repository or regenerate existing Nx projects unless the current implementation is broken.

---

## Phase 0A - Replace Aspire with Docker Compose

### Goal

Remove Aspire from the implemented Phase 0 setup and establish Docker Compose as the local infrastructure workflow without losing the working Nx applications, tests or GitHub validation.

### Chosen local-development model

Docker Compose manages infrastructure only:

- PostgreSQL 16 with pgvector.
- Azurite Blob Storage.
- Azurite Queue Storage.

These run as host Node processes through Nx:

- React/Vite web application.
- NestJS/Fastify API.
- Ingestion worker.

Normal development workflow:

```bash
docker compose up -d
pnpm nx run-many -t serve --projects=web,api,ingestion-worker
```

A root convenience script may wrap these commands, but the individual commands must remain available and documented.

### First step: inspect the implemented Phase 0

Before editing, identify:

- Aspire AppHost directories and files.
- Aspire package dependencies.
- Aspire-specific root scripts.
- Aspire-specific environment variables.
- Aspire-generated launch or configuration files.
- Aspire-specific GitHub Actions steps.
- Aspire references in:
  - `README.md`
  - `CLAUDE.md`
  - `docs/PLAN.md`
  - Architecture decision records
  - Developer scripts
- Health checks or configuration that depend on Aspire-injected values.
- Existing Phase 0 work that must be preserved.

Do not delete files only because their names appear Aspire-related. Confirm usage first.

### Migration tasks

#### Remove Aspire

- Remove the Aspire AppHost project and Aspire-only generated files.
- Remove Aspire package dependencies.
- Remove Aspire CLI installation requirements.
- Remove Aspire commands and root scripts.
- Remove Aspire-specific environment and service-discovery assumptions.
- Remove Aspire-specific GitHub Actions steps.
- Remove Aspire from target architecture documentation.
- Preserve the Nx workspace, applications, libraries, linting, tests and GitHub workflow.

#### Add Docker Compose

Create a root `docker-compose.yml` containing:

- PostgreSQL 16 with pgvector.
- Azurite with Blob and Queue endpoints.
- Named volumes for PostgreSQL and Azurite data.
- Explicit health checks.
- Fixed development ports documented in `.env.example`.
- Restart behavior suitable for local development.
- A dedicated local Docker network where useful.
- Development-only credentials clearly marked as such.
- Explicit pinned image versions. Do not use `latest`.

Recommended local endpoints:

```text
PostgreSQL: localhost:5432
Azurite Blob: localhost:10000
Azurite Queue: localhost:10001
```

#### Application configuration

- Add validated local configuration for:
  - PostgreSQL connection string.
  - Azurite Blob endpoint or connection string.
  - Azurite Queue endpoint or connection string.
- Ensure API and worker use the shared configuration library.
- Keep configuration compatible with Azure managed identity and production endpoints later.
- Do not hard-code localhost values in application code.
- Update API health checks for:
  - PostgreSQL.
  - Blob Storage.
  - Queue Storage.

#### Root commands

Provide root scripts equivalent to:

```text
infra:up
infra:down
infra:logs
infra:reset
dev
build
lint
test
e2e
```

Required behavior:

- `infra:up`: starts PostgreSQL and Azurite.
- `infra:down`: stops containers without deleting data.
- `infra:logs`: follows infrastructure logs.
- `infra:reset`: deletes local volumes only when explicitly invoked.
- `dev`: starts web, API and worker through Nx.
- No script silently deletes local data.

#### GitHub Actions

- Keep build, lint and unit tests independent of Docker where practical.
- Start Docker Compose only for integration-test jobs that need PostgreSQL or Azurite.
- Wait for container health before running integration tests.
- Print or upload Docker Compose logs when integration tests fail.
- Always tear down Compose services at the end of the job.
- Remove Aspire and Aspire CLI installation.
- Keep GitHub OIDC and Azure deployment work for the deployment phase.

#### Documentation

Update the README with prerequisites:

- Node.js 22 LTS.
- pnpm.
- Docker Desktop or another Compose-compatible Docker installation.

Document exact commands for:

- Installing dependencies.
- Starting infrastructure.
- Starting applications.
- Running checks.
- Viewing infrastructure logs.
- Resetting local infrastructure.

Add or update an architecture decision record explaining why Docker Compose replaced Aspire.

### Expected structure after Phase 0A

```text
.github/
  workflows/
    validate.yml

apps/
  web/
  api/
  ingestion-worker/

libs/
  contracts/
  config/
  domain/
  testing/

docs/
  architecture/
    decisions/
  PLAN.md

docker-compose.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
nx.json
tsconfig.base.json
.env.example
.editorconfig
.gitignore
README.md
CLAUDE.md
```

Use `compose.yaml` instead of `docker-compose.yml` only when the repository already adopted that convention. Pick one filename and use it consistently.

### Acceptance criteria

- No Aspire project, package dependency, command or workflow step remains.
- `pnpm install --frozen-lockfile` succeeds.
- `docker compose config` succeeds.
- `docker compose up -d` starts PostgreSQL and Azurite.
- Both services become healthy.
- PostgreSQL has pgvector available.
- Blob and Queue Storage are reachable through Azurite.
- Web, API and worker run as host processes through Nx.
- Hot reload works for web and API.
- API health reports PostgreSQL, Blob Storage and Queue Storage status.
- `pnpm nx run-many -t build lint test` passes.
- Integration tests pass against Docker Compose services.
- GitHub Actions validation succeeds without installing Aspire.
- Failed integration-test jobs expose Docker Compose logs.
- README accurately describes the Docker Compose workflow.
- Existing Phase 0 functionality unrelated to Aspire remains intact.

### Tests

- Configuration validation tests.
- PostgreSQL connectivity integration test.
- pgvector availability test.
- Azurite Blob integration test.
- Azurite Queue integration test.
- API health integration test.
- GitHub Actions workflow validation.
- Manual hot-reload smoke test.

### Azure resources

None.

### Required for

Complete before starting Phase 1.

## Phase 1 - Database and domain model

### Goal

Create the persistence model with provenance and tenant boundaries from the start.

### Tasks

- Configure Drizzle ORM.
- Create schemas for:
  - Tenants
  - Users
  - Documents
  - Document versions
  - Ingestion jobs
  - Chunks
  - Conversations
  - Conversation documents
  - Messages
  - Message citations
- Add pgvector extension migration.
- Add generated PostgreSQL full-text search vector.
- Add indexes:
  - HNSW on embedding
  - GIN on search vector
  - B-tree on tenant and document filters
  - Unique content and idempotency keys
- Create the PDF locator Zod schema.
- Seed one POC tenant and user.
- Add repository interfaces and concrete Drizzle repositories.
- Make document deletion soft by default.

### Acceptance criteria

- Migrations apply against a new database.
- Seed inserts a document and chunks with PDF locators.
- Invalid locator JSON cannot be inserted through application code.
- `EXPLAIN` demonstrates use of vector and full-text indexes.
- Tenant-filtered repository tests pass.

### Tests

- Migration test.
- Repository integration tests.
- Locator schema unit tests.
- Tenant isolation tests.

### Azure resources

None.

### Required for

POC and production.

---

## Phase 2 - Blob Storage abstraction and direct upload

### Goal

Upload large PDF files directly to Azurite Blob Storage without passing file contents through the API.

### Tasks

- Define `ObjectStorage`.
- Implement an Azure Blob-compatible provider that uses Azurite locally.
- Implement:
  - Create upload target
  - Verify object
  - Read object stream
  - Create preview target
  - Delete object
- Add endpoints:
  - `POST /documents/upload-sessions`
  - `POST /documents/:id/complete-upload`
  - `GET /documents`
  - `GET /documents/:id`
  - `DELETE /documents/:id`
- Add file metadata validation.
- Add short-lived scoped upload URLs.
- Upload directly from the browser to Azurite Blob Storage.
- Show upload progress in the web app.
- Add upload state transitions.
- Make complete-upload idempotent.
- Do not send the queue message until storage verification succeeds.

### Acceptance criteria

- Browser uploads a 100 MB fixture directly to Azurite Blob Storage.
- API memory use does not grow with file size.
- Upload URL cannot write an arbitrary blob name.
- Expired upload URLs fail.
- Repeating completion does not duplicate ingestion jobs.
- Invalid file type and oversized file return clear errors.

### Tests

- Blob Storage integration tests using Azurite.
- Upload endpoint tests.
- Idempotency tests.
- Large upload smoke test.

### Azure resources

None.

### Required for

POC. The same storage abstraction is used with Azure Blob Storage later.

## Phase 3 - PDF ingestion

### Goal

Process text-based PDFs asynchronously and preserve exact source coordinates.

### Tasks

- Define `DocumentParser`.
- Create parser registry keyed by MIME type.
- Implement PDF parser using PDF.js-compatible text extraction.
- Preserve:
  - Page number
  - Text items
  - Text order
  - Bounding boxes or polygons
  - Page dimensions
- Normalize extracted elements.
- Create deterministic chunks:
  - Target 500 to 800 tokens
  - Avoid crossing page boundaries
  - Preserve headings where detectable
  - Approximately 10 to 15 percent overlap only when useful
  - Stable chunk hashes
- Add embedding service using AI SDK.
- Batch embedding calls.
- Implement the Azure Queue Storage ingestion pipeline:
  - Parse
  - Normalize
  - Persist normalized artifact
  - Chunk
  - Embed
  - Insert chunks
  - Mark document ready
- Implement retries using dequeue count, visibility timeout and configurable backoff.
- Renew message visibility during long-running processing.
- Move messages exceeding the retry limit to a poison queue.
- Ensure retries delete or replace partial output safely.
- Store parser and chunker version.

### Acceptance criteria

- Uploading a real multi-page PDF returns immediately.
- Status changes from uploaded to queued to processing to ready.
- Every chunk has page and coordinate metadata.
- Spot checks match visible source text.
- A 100-page PDF processes without blocking the API.
- A failed job has a safe user-facing error and detailed internal error code.
- Retrying the same version does not duplicate chunks.

### Tests

- PDF parser unit tests.
- Golden PDF extraction tests.
- Chunking unit tests.
- Worker integration tests.
- Retry and idempotency tests.
- Large PDF performance test.

### Azure resources

Azure OpenAI may be used for embeddings during development, with a strict token cap.

### Required for

First vertical slice.

---

## Phase 4 - PostgreSQL hybrid retrieval

### Goal

Retrieve relevant, authorized chunks without Azure AI Search.

### Tasks

- Implement vector search.
- Implement PostgreSQL full-text search.
- Fuse results using reciprocal rank fusion.
- Add mandatory filters:
  - Tenant ID
  - User access
  - Document scope: whole tenant corpus by default; selected document IDs when the conversation has an explicit selection
  - Active document version
  - Not deleted
- Add exact-match handling for identifiers.
- Implement context assembly.
- Cap:
  - Candidate count
  - Selected chunk count
  - Total context tokens
- Add retrieval diagnostics in development.
- Build an evaluation harness.
- Add 5 to 10 fixture questions with expected source pages.

### Acceptance criteria

- Semantic questions retrieve the expected page.
- Exact identifiers are found through full-text search.
- When a conversation has an explicit document selection, retrieval cannot return chunks from outside that selection.
- Without a selection, retrieval covers the whole tenant corpus and never crosses tenant boundaries.
- Retrieval cannot cross tenant boundaries.
- Evaluation output separates:
  - Retrieval hit rate
  - Citation location correctness

### Tests

- SQL integration tests.
- Authorization filter tests.
- RRF unit tests.
- Context budget tests.
- Evaluation harness.

### Azure resources

Azure OpenAI embeddings only.

### Required for

First vertical slice.

---

## Phase 5 - Streamed chat and validated citations

### Goal

Generate streamed answers whose citations are validated by the backend.

### Tasks

- Configure the official AI SDK Azure provider.
- Add provider-independent AI configuration.
- Add conversation endpoints.
- Add selected-document endpoints (optional narrowing; an empty selection means the whole tenant corpus).
- Add message endpoint with streamed response.
- Add typed citation data in the stream.
- Persist user and assistant messages.
- Persist cited chunk IDs.
- Add cancellation with `AbortController`.
- Add answer retry.
- Add answer regeneration.
- Keep only recent raw messages.
- Add conversation summaries when history grows.
- Rewrite follow-up questions into standalone retrieval queries.
- Validate citation IDs before returning a completed answer.
- Return insufficient-information responses when evidence is weak.
- Record:
  - Input tokens
  - Output tokens
  - Model deployment
  - Estimated cost
  - Retrieval latency
  - Model latency

### Acceptance criteria

- A client receives tokens incrementally.
- Citation data arrives in a typed structure.
- The answer cannot cite a chunk outside the retrieved set.
- An invented citation ID causes validation failure.
- Cancellation stops generation.
- Messages and citations are persisted.
- Questions outside the documents return insufficient information.

### Tests

- Streaming integration test.
- Citation validation tests.
- Cancellation test.
- Conversation scoping tests.
- Token-budget tests.
- Model provider mock tests.

### Azure resources

Azure OpenAI.

### Required for

First vertical slice.

---

## Phase 6 - React document library, chat and PDF viewer

### Goal

Complete the first end-to-end browser experience.

### Tasks

#### Document library

- Multi-file dropzone.
- Upload progress.
- Status polling.
- Processing errors.
- Retry button.
- Delete button.
- Optional file selection for conversations (default is the whole tenant corpus).

#### Chat

- Conversation list.
- Selected document scope.
- Streamed messages.
- Markdown rendering.
- Inline citation chips.
- Stop generation.
- Retry and regenerate actions.
- Loading, empty and failure states.

#### PDF viewer

- Render PDF using `react-pdf`.
- Fetch the PDF through an authorized preview URL.
- Navigate to the cited page.
- Convert normalized source polygons to rendered coordinates.
- Draw highlight overlays.
- Show cited excerpt.
- Switch between citations.

### Acceptance criteria

A user can:

1. Upload one PDF.
2. Wait for processing.
3. Create a conversation.
4. Select the PDF.
5. Ask a question.
6. See a streamed answer.
7. Click a citation.
8. Open the correct page.
9. See the cited region highlighted.

### Tests

- React component tests.
- Upload flow test.
- Stream rendering test.
- Citation interaction test.
- Playwright end-to-end happy path.
- PDF coordinate scaling test.

### Azure resources

None beyond optional Azure OpenAI usage.

### Required for

First usable POC milestone.

---

## Phase 7 - Optional later extension: XLSX ingestion and source viewer

This phase starts only after the complete PDF flow works locally and in Azure. It is not part of the initial implementation.

### Goal

Add spreadsheet support with exact worksheet and cell-range citations.

### Tasks

- Implement XLSX parser using ExcelJS.
- Preserve:
  - Workbook name
  - Worksheet name
  - Cell address
  - Displayed value
  - Raw value
  - Formula
  - Headers
  - Tables
  - Hidden worksheet, row and column metadata
- Enforce workbook safety limits before full processing.
- Detect tables and tabular regions.
- Repeat relevant headers in each chunk.
- Avoid splitting related rows unnecessarily.
- Store exact cell ranges in locators.
- Create read-only worksheet-range endpoint.
- Avoid sending a complete huge workbook to the browser.
- Build virtualized read-only grid.
- Scroll to cited range.
- Highlight cited cells.
- Show displayed values and formulas where useful.
- Document that RAG is not reliable for exact workbook-wide calculations.
- Add an extension point for a later deterministic spreadsheet-analysis tool.

### Acceptance criteria

- Upload and process a multi-sheet workbook.
- Ask a question whose answer exists in one sheet.
- Citation returns the correct worksheet and range.
- Clicking the citation opens the worksheet and highlights the cells.
- Large sheets are loaded by requested range, not as one browser payload.
- Hidden content behavior is explicit and tested.

### Tests

- ExcelJS parser tests.
- Golden workbook tests.
- Formula and displayed-value tests.
- Range locator tests.
- Spreadsheet viewer end-to-end test.
- ZIP bomb and size-limit tests.

### Azure resources

No additional Azure service.

### Required for

Full requested POC.

---

## Phase 8 - Azure deployment through Bicep and GitHub Actions

### Goal

Deploy the application to Azure within the €130 monthly budget using explicit Bicep for infrastructure and GitHub Actions for CI/CD.

### Tasks

#### Azure infrastructure

Create Bicep modules for:

- Azure Blob Storage.
- Azure Queue Storage, including poison queue.
- Azure Container Registry Basic.
- Azure Container Apps environment.
- Web Container App.
- API Container App.
- Worker Container App.
- PostgreSQL Flexible Server.
- Azure OpenAI account and deployments, or a reference to an existing account.
- Application Insights and Log Analytics.
- Managed identities and RBAC assignments.
- Azure Cost Management budget and alerts where deployment permissions allow.

Keep resource SKUs, scaling, retention and networking explicit. Do not rely on generated defaults.

#### Containers

- Add production Dockerfiles for web, API and worker.
- Use non-root containers.
- Use small runtime images.
- Add health and readiness probes.
- Configure graceful shutdown.
- Ensure the worker safely abandons or completes an in-flight queue message during shutdown.

#### Scaling

- Web minimum replicas: `0`.
- API minimum replicas: `0`.
- Worker minimum replicas: `0`.
- Set low explicit maximum replica counts.
- Configure the worker with an Azure Queue Storage KEDA scale rule.
- Test scale-from-zero with a real queue message.

#### GitHub

- Store source code in a GitHub repository.
- Use pull requests and branch protection for the default branch.
- Add required build, lint and test checks.
- Use GitHub Actions for CI/CD.
- Authenticate GitHub Actions to Azure using OIDC.
- Do not store long-lived Azure credentials in GitHub secrets.
- Use Azure Container Registry Basic for container images.
- Do not use GitHub Container Registry.
- Configure Container Apps to pull from ACR using managed identity.

#### GitHub Actions workflow

The deployment workflow must:

1. Check out the repository.
2. Install Node.js 22, pnpm and Azure CLI.
3. Restore dependencies.
4. Run affected Nx build, lint and tests.
5. Run integration tests where appropriate.
6. Authenticate to Azure using GitHub OIDC.
7. Validate and deploy Bicep.
8. Build and publish container images to ACR.
9. Update Azure Container Apps.
10. Run deployment smoke tests.

### Acceptance criteria

- Full stack is reachable in Azure.
- API and worker scale to zero.
- An Azure Queue Storage message wakes the worker.
- Browser uploads directly to Azure Blob Storage.
- Managed identities are used where supported.
- Container Apps pull images from ACR without registry passwords.
- PostgreSQL and Storage access are no broader than required for the POC.
- The estimated recurring cost remains below €110, preserving at least €20 buffer.
- Azure budget alerts exist.
- A complete PDF happy path works in Azure.
- A merge to the deployment branch can deploy through GitHub Actions without long-lived Azure credentials.

### Tests

- Bicep lint and validation.
- What-if deployment review.
- Container smoke tests.
- Azure integration tests run only when explicitly enabled.
- Deployment smoke test.
- Queue scale-from-zero test.
- GitHub OIDC authentication test.
- Budget checklist.

### Azure resources

All listed POC resources.

### Required for

Hosted POC.

## Phase 9 - Entra authentication and tenant authorization

### Goal

Replace the seeded POC user with real authentication and enforce access server-side.

### Tasks

- Register frontend and API applications in Microsoft Entra ID.
- Add React authentication using MSAL.
- Validate access tokens in NestJS.
- Map Entra subject and tenant claims to application users.
- Add authorization guards.
- Enforce tenant and user ownership in repositories.
- Ensure retrieval always applies authorization filters.
- Ensure preview and download endpoints enforce authorization.
- Add audit logging for:
  - Upload
  - Delete
  - Conversation creation
  - Chat request
  - Failed authorization
- Do not log document content or prompts by default.

### Acceptance criteria

- Unauthenticated API calls fail.
- Users can access only authorized files.
- Search cannot cross tenant boundaries.
- Citation preview cannot bypass file authorization.
- Deleted files cannot be retrieved or previewed.
- Authorization tests cover guessed document and citation IDs.

### Tests

- Token validation tests.
- Authorization integration tests.
- Cross-tenant retrieval tests.
- Insecure direct-object-reference tests.
- Audit event tests.

### Azure resources

Entra app registrations only. No meaningful recurring cost.

### Required for

Production path. Optional for a private single-user demo.

---

## Phase 10 - Production hardening, observability and evaluation

### Goal

Prove reliability, security, answer traceability and cost control.

### Tasks

#### Security

- Rate limiting.
- Request-size limits.
- File-signature and MIME validation.
- PDF parser safety limits.
- XLSX decompression and cell limits.
- Malware-scanning extension point.
- Prompt-injection defenses.
- Mark document content as untrusted.
- HTML and Markdown sanitization.
- Secure deletion workflow.
- Secret rotation documentation.
- Dependency and container scanning.

#### Observability

- Correlation IDs.
- OpenTelemetry tracing.
- Structured logs.
- Ingestion metrics.
- Parser duration.
- Page, sheet, row and chunk counts.
- Embedding usage.
- Chat token usage.
- Retrieval latency.
- Model latency.
- Citation validation failures.
- Queue retries.
- Poison jobs.
- Estimated cost per file.
- Estimated cost per chat request.

#### Evaluation

Create a RAG evaluation dataset:

```text
question
expected answer
expected source document
expected page or cell range
answerable yes/no
```

Measure separately:

- Retrieval recall
- Citation correctness
- Answer faithfulness
- Answer completeness
- Refusal correctness
- Latency
- Estimated cost

#### Operations

- Backup and restore procedure.
- Failed ingestion runbook.
- Queue Storage outage behavior.
- Model outage behavior.
- Database recovery instructions.
- Blob cleanup job.
- Reindex without reparse.
- Delete and re-upload behavior.
- Cost investigation runbook.

### Acceptance criteria

- Security tests pass.
- Tenant-isolation tests pass.
- A failed worker job can be retried safely.
- Reindexing does not require reparsing.
- Deleting a document removes it from retrieval immediately.
- Cost metrics identify the most expensive documents and requests.
- Evaluation report is reproducible.
- Load test remains within configured API, worker and AI limits.
- Monthly projected Azure cost remains below €130.

### Tests

- Prompt-injection tests.
- Rate-limit tests.
- Retry tests.
- Idempotency tests.
- Large-file performance tests.
- Load tests.
- Restore test.
- RAG evaluation suite.

### Azure resources

No new fixed-cost services without explicit budget review.

### Required for

Production readiness.

---

## 10. API outline

### Documents

```text
POST   /documents/upload-sessions
POST   /documents/:documentId/complete-upload
GET    /documents
GET    /documents/:documentId
POST   /documents/:documentId/retry
DELETE /documents/:documentId
GET    /documents/:documentId/preview-url
GET    /documents/:documentId/xlsx/worksheets
GET    /documents/:documentId/xlsx/worksheets/:worksheet/range
```

### Conversations

```text
POST   /conversations
GET    /conversations
GET    /conversations/:conversationId
PATCH  /conversations/:conversationId/documents
GET    /conversations/:conversationId/messages
POST   /conversations/:conversationId/messages
POST   /conversations/:conversationId/messages/:messageId/retry
POST   /conversations/:conversationId/messages/:messageId/regenerate
POST   /conversations/:conversationId/generations/:generationId/cancel
```

### Citations

```text
GET /citations/:citationId
```

The citation endpoint returns safe metadata only after authorization.

---

## 11. Required configuration

```dotenv
NODE_ENV=development

DATABASE_URL=

AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_ACCOUNT_NAME=
AZURE_STORAGE_BLOB_CONTAINER_ORIGINALS=
AZURE_STORAGE_BLOB_CONTAINER_ARTIFACTS=
AZURE_STORAGE_QUEUE_INGESTION=rag-ingestion
AZURE_STORAGE_QUEUE_POISON=rag-ingestion-poison
QUEUE_VISIBILITY_TIMEOUT_SECONDS=300
QUEUE_MAX_DEQUEUE_COUNT=5
AI_PROVIDER=azure
AZURE_OPENAI_RESOURCE_NAME=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_CHAT_DEPLOYMENT=
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=

MAX_FILE_SIZE_BYTES=104857600
MAX_PDF_PAGES=500
# Add these only when the later XLSX phase starts:
# MAX_XLSX_WORKSHEETS=50
# MAX_XLSX_ROWS=250000
# MAX_XLSX_CELLS=2000000

CHUNK_TARGET_TOKENS=650
CHUNK_OVERLAP_TOKENS=80
EMBEDDING_BATCH_SIZE=64

RETRIEVAL_VECTOR_TOP_K=20
RETRIEVAL_TEXT_TOP_K=20
RETRIEVAL_FINAL_TOP_K=8
MAX_CONTEXT_TOKENS=9000
MAX_OUTPUT_TOKENS=1200

UPLOAD_URL_TTL_SECONDS=900
PREVIEW_URL_TTL_SECONDS=300

CHAT_REQUESTS_PER_USER_PER_HOUR=100
MAX_MONTHLY_TENANT_CHAT_TOKENS=
MAX_MONTHLY_TENANT_EMBEDDING_TOKENS=

OTEL_ENABLED=false
LOG_LEVEL=info
```

Do not treat these defaults as immutable. Validate them against real fixture files and evaluation results.

---

## 12. POC shortcuts versus production requirements

### Acceptable POC shortcuts

- One seeded tenant before Entra integration.
- Text-based PDFs only for the first vertical slice.
- Smallest suitable non-HA PostgreSQL tier.
- Polling for document status.
- Limited backup retention.
- Manual environment shutdown.
- No malware-scanning implementation, but keep an extension point.
- No OCR in the POC.
- No Azure AI Search.
- No semantic reranker.

### Must not be postponed for the initial PDF milestone

- PDF source locators on every chunk.
- Asynchronous ingestion.
- Direct-to-storage upload.
- Backend citation validation.
- Tenant fields in the data model.
- Retrieval filters.
- Idempotent jobs.
- File and token limits.
- Cost logging.
- Separate normalized content from embeddings.
- Ability to delete a document from retrieval.
- Exact PDF citation navigation.
- Exact XLSX citation navigation when the later XLSX phase is implemented.

---

## 13. Five largest technical risks

1. **PDF coordinates do not match the rendered PDF**
   - Mitigation: normalize coordinates against page dimensions and add golden visual tests.

2. **Spreadsheet chunks lose header context**
   - Mitigation: detect table regions and repeat relevant headers in each chunk.

3. **Model citations are syntactically valid but unsupported**
   - Mitigation: require structured segments and validate citations against retrieved evidence.

4. **Queue-triggered worker scale-to-zero does not wake reliably**
   - Mitigation: test the Azure Queue Storage KEDA rule with real scale-from-zero scenarios.

5. **PostgreSQL hybrid retrieval degrades as the index grows**
   - Mitigation: instrument query plans, isolate retrieval behind an interface and retain reindexable normalized content.

---

## 14. Five largest cost risks

1. PostgreSQL is accidentally deployed on a larger SKU.
2. PostgreSQL, Log Analytics or Container Apps are configured with oversized SKUs, retention or minimum replicas.
3. Container Apps retain minimum replicas greater than zero.
4. Chat context and output limits are left unbounded.
5. Application Insights ingests verbose logs or document content.

Every pull request that changes infrastructure, model use, logging or retrieval limits must update the cost-impact section in its description.

---

## 15. Exact first vertical slice

Implement only:

1. Docker Compose for PostgreSQL with pgvector and Azurite.
2. React web app running locally with hot reload.
3. NestJS Fastify API running locally with hot reload.
4. Separate worker consuming Azure Queue Storage messages.
5. Direct browser upload to Azurite Blob Storage.
6. Text-based PDF parsing.
7. PDF chunks with page and bounding-polygon locators.
8. Azure OpenAI embeddings.
9. pgvector plus full-text retrieval.
10. Streamed answer with backend-validated citations.
11. PDF viewer with page navigation and highlighted citation.

Do not implement XLSX, Entra ID or Azure deployment before this PDF flow works end to end.

---

## 16. Definition of done for every phase

Claude Code must finish each phase by reporting:

1. Files changed.
2. Architectural decisions made.
3. Commands run.
4. Test results.
5. Acceptance criteria evidence.
6. Known limitations.
7. Azure cost impact.
8. Security impact.
9. Remaining work for the next phase.

A phase is not complete when tests are skipped without explanation.

---

# CLAUDE.md

Copy the section below into `CLAUDE.md` in the repository root.

```markdown
# Project: Document Chat RAG

This repository contains a production-oriented RAG POC with a hard Azure budget of €130 per month.

## Stack

- Nx monorepo
- React + Vite
- NestJS with Fastify
- TypeScript ingestion worker
- Drizzle ORM
- PostgreSQL + pgvector
- Azure Queue Storage
- Azurite locally
- Azure Blob Storage and Queue Storage in Azure
- Docker Compose for local infrastructure
- Vercel AI SDK
- Azure OpenAI
- Azure Container Apps

## Commands

- Start local infrastructure: `docker compose up -d`
- Start development apps: `pnpm nx run-many -t serve --projects=web,api,ingestion-worker`
- Build: `npx nx run-many -t build`
- Lint: `npx nx run-many -t lint`
- Test: `npx nx run-many -t test`
- Run affected checks: `npx nx affected -t build lint test`
- Start development apps: `npx nx run-many -t serve`
- Apply migrations: use the database target documented in the root README
- Run RAG evaluation: use the target documented under `tools/eval`

## Non-negotiable rules

- TypeScript everywhere.
- No LangChain.
- No LlamaIndex.
- Use the official AI SDK Azure provider.
- All model deployments and limits come from validated configuration.
- No document parsing inside an HTTP request handler.
- Files upload directly to object storage.
- Every persisted chunk must have a valid source locator.
- PDF locators contain page and normalized polygons.
- When XLSX support is implemented later, its locators must contain worksheet and exact cell range.
- Citation metadata comes from the database, never from the model.
- Reject unknown model citation IDs.
- Every factual answer segment needs evidence.
- Retrieval must filter by tenant, authorization, document scope (whole tenant corpus by default, the explicit selection when one exists) and active versions.
- PostgreSQL is the source of truth.
- Store normalized extraction output separately from embeddings.
- Ingestion must be retryable and idempotent.
- Do not log document text, prompts, answers or embeddings by default.
- Enforce file, page, cell, token and request limits.
- Keep API, worker and web separately deployable.
- Keep domain logic outside NestJS controllers and React components.
- Prefer explicit code over framework-heavy abstractions.
- Do not add Azure AI Search, Document Intelligence, private endpoints, HA or always-running replicas during the POC.
- Use Docker Compose for local PostgreSQL and Azurite.
- Run web, API and worker as host Nx processes locally.
- Use explicit Bicep plus GitHub Actions for Azure deployment.
- Keep Docker Compose limited to local infrastructure unless a later phase explicitly requires application-container smoke tests.
- Use GitHub repository and GitHub Actions for source control and CI/CD.
- Use GitHub OIDC for Azure authentication.
- Use Azure Container Registry Basic, not GitHub Container Registry.
- This is a greenfield repository. Do not search for or preserve nonexistent legacy conventions.
- Use pnpm and keep exactly one root lock file.
- Target Node.js 22 LTS.
- Keep one root package.json managed through Nx.
- Add GitHub validation workflows during Phase 0.
- Do not add an Azure resource estimated above €15 per month without documenting its necessity and recalculating the complete budget.
- Preserve at least €20 monthly headroom below the €130 Azure budget.

## Working process

Before implementing a phase:

1. Read `docs/PLAN.md` and this file.
2. Phase 0 is already implemented.
3. Implement Phase 0A next.
4. Inspect the current Phase 0 implementation and identify all Aspire-specific files, dependencies, scripts, workflow steps and documentation before editing.
5. Preserve working Nx applications, libraries, tests and GitHub validation.
6. Propose the smallest safe migration to Docker Compose.
7. Do not start Phase 1 until all Phase 0A acceptance criteria pass.

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
```

---

## Recommended architecture summary

Build the application as an Nx TypeScript monorepo with React, NestJS/Fastify and a separate ingestion worker. Use Docker Compose locally for PostgreSQL with pgvector and Azurite Blob and Queue Storage. Run web, API and worker as host Node processes through Nx for hot reload and debugging. Use Azure Blob Storage and Azure Queue Storage in Azure. Store metadata, full-text indexes and vectors in PostgreSQL. Use Azure OpenAI through the official AI SDK Azure provider. Deploy Azure infrastructure explicitly with Bicep through GitHub Actions using GitHub OIDC. Store container images in Azure Container Registry Basic. Do not use Aspire, MinIO, Redis, BullMQ or Azure AI Search during the POC.

## Unresolved questions

None block the first vertical slice.
