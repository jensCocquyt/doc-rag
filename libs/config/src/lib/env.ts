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

export const apiEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export const workerEnvSchema = baseEnvSchema;

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
