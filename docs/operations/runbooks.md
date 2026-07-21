# Operations runbooks (Phase 10)

Applies locally (Docker Compose) and in Azure (Container Apps) unless noted.

## Failed ingestion

Symptoms: document stuck at `failed` (or `queued` with no progress).

1. Find the job:
   `SELECT id, status, attempt, error_code, error_message FROM ingestion_jobs j JOIN document_versions v ON v.id = j.document_version_id WHERE v.document_id = '<doc-id>';`
2. Interpret `error_code`:
   - `parse_failed`, `invalid_file_signature`, `page_limit_exceeded`,
     `file_too_large`, `no_text_content` → the file itself is the problem;
     retrying will not help. Ask for a corrected upload.
   - `transient_error` / `retries_exhausted` (poisoned) → infrastructure was
     unhealthy. Check the poison queue (`rag-ingestion-poison`) for the raw
     message; fix the cause, then press **Retry** in the UI (or
     `POST /documents/:id/retry`) — it re-verifies storage, requeues the job
     and re-sends the message.
3. Worker logs carry the job id on every line; no document content is logged.

## Queue Storage outage

The API keeps accepting uploads until the queue send in complete-upload
fails (the document then stays `uploaded` and the client can retry).
The worker's poll loop logs failures and keeps retrying — no crash, no
message loss (messages are only deleted after successful processing).
After recovery, use **Retry** for any documents stranded at `queued`.

## Model (Azure OpenAI) outage

Chat requests fail with `generation_failed`; the user message is persisted
and can be retried. Ingestion embedding failures are transient errors →
automatic redelivery with backoff, then poison queue. No partial chunk sets
are exposed (wipe-and-rewrite per version).

## Database backup and restore

Local: `pg_dump -Fc "$DATABASE_URL" > backup.dump`, restore with
`pg_restore -d "$DATABASE_URL" --clean backup.dump`. Blobs are unaffected;
chunks can always be rebuilt (see reindex).
Azure: PostgreSQL Flexible Server point-in-time restore (7-day retention)
via `az postgres flexible-server restore`. After restore, run
`pnpm db:migrate` and reconcile any documents uploaded after the restore
point (they will be missing rows but present in Blob Storage).

## Reindex without reparse

After changing the chunker or embedding model:
`pnpm tsx tools/scripts/reindex.ts` — rebuilds all chunks from the stored
normalized artifacts; no PDF is reparsed. Verify with a chat question.

## Delete and re-upload

Deleting a document (UI or `DELETE /documents/:id`) soft-deletes it: it
disappears from lists and retrieval immediately (SQL filters), while blobs
remain until cleanup. Re-uploading the same file creates a new document.
Blob cleanup: `pnpm tsx tools/scripts/cleanup-blobs.ts --days 30` (dry-run;
add `--apply` to delete).

## Cost investigation (Azure)

1. Portal → Cost Management → resource group `rg-docrag-poc`, group by
   resource. Expected order: PostgreSQL > OpenAI > ACR > storage/logs.
2. Token spend: `SELECT model, sum(input_tokens), sum(output_tokens), sum(estimated_cost) FROM messages GROUP BY model;`
   and per-document embedding volume from worker success logs.
3. Most expensive levers: stop PostgreSQL when idle, keep Container Apps
   min replicas at 0, check the Log Analytics daily cap is still active.

## Load probe

`pnpm tsx tools/scripts/load-test.ts` against a running API reports
throughput, latency percentiles and confirms the rate limiter engages.
