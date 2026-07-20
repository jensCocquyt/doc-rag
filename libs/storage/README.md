# @doc-rag/storage

`ObjectStorage` boundary and its Azure Blob implementation (Azurite locally,
Azure Blob Storage in Azure). The API mints short-lived SAS URLs scoped to one
server-chosen blob name; file bytes never pass through the API process.

Integration tests (`pnpm nx test-integration storage`) need the local
infrastructure running (`pnpm infra:up`) and the Azurite connection string in
the environment (see `.env.example`).
