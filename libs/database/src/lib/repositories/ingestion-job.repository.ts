import { eq } from 'drizzle-orm';
import { Database } from '../client';
import { ingestionJobs } from '../schema';

export type IngestionJobRecord = typeof ingestionJobs.$inferSelect;

export interface IngestionJobRepository {
  /**
   * Creates the job for an idempotency key, or returns the existing one.
   * Backed by the unique index on idempotency_key, so concurrent
   * complete-upload calls can never produce two jobs for the same version.
   */
  createIfAbsent(input: {
    documentVersionId: string;
    idempotencyKey: string;
  }): Promise<{ job: IngestionJobRecord; created: boolean }>;
}

export class DrizzleIngestionJobRepository implements IngestionJobRepository {
  constructor(private readonly db: Database) {}

  async createIfAbsent(input: {
    documentVersionId: string;
    idempotencyKey: string;
  }): Promise<{ job: IngestionJobRecord; created: boolean }> {
    const inserted = await this.db
      .insert(ingestionJobs)
      .values(input)
      .onConflictDoNothing({ target: ingestionJobs.idempotencyKey })
      .returning();
    if (inserted.length > 0) {
      return { job: inserted[0], created: true };
    }
    const [existing] = await this.db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return { job: existing, created: false };
  }
}
