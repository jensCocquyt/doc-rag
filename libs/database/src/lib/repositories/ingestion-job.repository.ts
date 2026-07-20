import { eq } from 'drizzle-orm';
import { IngestionJobStatus } from '@doc-rag/contracts';
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
  findById(id: string): Promise<IngestionJobRecord | null>;
  /** Records a delivery attempt starting. */
  markProcessing(id: string, attempt: number): Promise<void>;
  markSucceeded(id: string): Promise<void>;
  /**
   * Records the failure detail. `status` distinguishes a retryable failure
   * ('queued' — the message will be redelivered), a terminal 'failed', and
   * 'poisoned' (moved to the poison queue).
   */
  markFailed(
    id: string,
    status: Extract<IngestionJobStatus, 'queued' | 'failed' | 'poisoned'>,
    errorCode: string,
    errorMessage: string,
  ): Promise<void>;
  /** Puts a terminal job back in line for a user-requested retry. */
  requeue(id: string): Promise<void>;
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

  async findById(id: string): Promise<IngestionJobRecord | null> {
    const [row] = await this.db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, id))
      .limit(1);
    return row ?? null;
  }

  async markProcessing(id: string, attempt: number): Promise<void> {
    await this.db
      .update(ingestionJobs)
      .set({ status: 'processing', attempt, startedAt: new Date() })
      .where(eq(ingestionJobs.id, id));
  }

  async markSucceeded(id: string): Promise<void> {
    await this.db
      .update(ingestionJobs)
      .set({
        status: 'succeeded',
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
      })
      .where(eq(ingestionJobs.id, id));
  }

  async requeue(id: string): Promise<void> {
    await this.db
      .update(ingestionJobs)
      .set({
        status: 'queued',
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      })
      .where(eq(ingestionJobs.id, id));
  }

  async markFailed(
    id: string,
    status: 'queued' | 'failed' | 'poisoned',
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.db
      .update(ingestionJobs)
      .set({
        status,
        errorCode,
        errorMessage,
        ...(status !== 'queued' ? { completedAt: new Date() } : {}),
      })
      .where(eq(ingestionJobs.id, id));
  }
}
