import { config as loadDotenvFile } from 'dotenv';
import { z } from 'zod';

/**
 * Loads a .env file (workspace root by default) into process.env without
 * overriding variables that are already set. No-op when the file is absent,
 * so production environments that inject real env vars are unaffected.
 */
export function loadDotenv(path?: string): void {
  loadDotenvFile({ ...(path ? { path } : {}), quiet: true });
}

/**
 * Accepts either a postgresql:// URI or an ADO.NET-style connection string
 * (Host=...;Port=...;Username=...;Password=...;Database=...) and returns a
 * postgresql:// URI. Azure-provisioned connection strings commonly use the
 * ADO.NET form; node-postgres needs the URI form.
 */
export function normalizeDatabaseUrl(raw: string): string {
  if (/^postgres(ql)?:\/\//i.test(raw)) {
    return raw;
  }
  const pairs = raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=');
      return [
        part.slice(0, separator).trim().toLowerCase(),
        part.slice(separator + 1).trim(),
      ] as const;
    });
  const kv = Object.fromEntries(pairs);
  const host = kv['host'] ?? kv['server'];
  if (!host) {
    throw new Error(
      'DATABASE_URL is neither a postgresql:// URI nor a Host=... connection string',
    );
  }
  const port = kv['port'] ?? '5432';
  const user = kv['username'] ?? kv['user id'] ?? 'postgres';
  const password = kv['password'];
  const database = kv['database'] ?? 'postgres';
  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  return `postgresql://${auth}@${host}:${port}/${database}`;
}

/**
 * Environment contract. Locally the values point at the Docker Compose
 * infrastructure (see docker-compose.yml and .env.example); in Azure they come
 * from the deployed environment. Always validated before use.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .transform(normalizeDatabaseUrl),
  AZURE_STORAGE_BLOB_CONNECTION_STRING: z
    .string()
    .min(1, 'AZURE_STORAGE_BLOB_CONNECTION_STRING is required'),
  AZURE_STORAGE_QUEUE_CONNECTION_STRING: z
    .string()
    .min(1, 'AZURE_STORAGE_QUEUE_CONNECTION_STRING is required'),
});

const storageEnvSchema = baseEnvSchema.extend({
  AZURE_STORAGE_BLOB_CONTAINER_ORIGINALS: z.string().min(1).default('originals'),
  AZURE_STORAGE_QUEUE_INGESTION: z.string().min(1).default('rag-ingestion'),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(104857600),
});

export const apiEnvSchema = storageEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  PREVIEW_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  RETRIEVAL_VECTOR_TOP_K: z.coerce.number().int().positive().default(20),
  RETRIEVAL_TEXT_TOP_K: z.coerce.number().int().positive().default(20),
  RETRIEVAL_FINAL_TOP_K: z.coerce.number().int().positive().default(8),
  MAX_CONTEXT_TOKENS: z.coerce.number().int().positive().default(9000),
});

export const workerEnvSchema = storageEnvSchema
  .extend({
    AZURE_STORAGE_BLOB_CONTAINER_ARTIFACTS: z
      .string()
      .min(1)
      .default('artifacts'),
    AZURE_STORAGE_QUEUE_POISON: z
      .string()
      .min(1)
      .default('rag-ingestion-poison'),
    QUEUE_VISIBILITY_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
    QUEUE_MAX_DEQUEUE_COUNT: z.coerce.number().int().positive().default(5),
    QUEUE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
    MAX_PDF_PAGES: z.coerce.number().int().positive().default(500),
    CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(650),
    CHUNK_OVERLAP_TOKENS: z.coerce.number().int().positive().default(80),
    EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(64),
    /**
     * 'azure' is the real provider; 'fake' selects deterministic pseudo-
     * embeddings for local/CI runs without credentials. Always an explicit
     * choice — a missing key with AI_PROVIDER=azure is a startup error, not
     * a downgrade.
     */
    AI_PROVIDER: z.enum(['azure', 'fake']).default('azure'),
    AZURE_OPENAI_RESOURCE_NAME: z.string().optional(),
    AZURE_OPENAI_API_KEY: z.string().optional(),
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER !== 'azure') return;
    for (const key of [
      'AZURE_OPENAI_RESOURCE_NAME',
      'AZURE_OPENAI_API_KEY',
      'AZURE_OPENAI_EMBEDDING_DEPLOYMENT',
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when AI_PROVIDER=azure`,
        });
      }
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export function loadApiEnv(
  source: Record<string, string | undefined> = process.env,
): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}

export function loadWorkerEnv(
  source: Record<string, string | undefined> = process.env,
): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}
