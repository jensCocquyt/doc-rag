import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@doc-rag/config';
import { API_ENV } from '../env.provider';

/**
 * Per-user sliding-hour chat quota (PLAN.md §3: per-user quotas; refuse
 * requests that would exceed configured limits). In-memory is sufficient for
 * the single-replica POC; a shared store is the multi-replica follow-up.
 */
@Injectable()
export class ChatQuotaService {
  private readonly requestTimes = new Map<string, number[]>();

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Records the request; throws 429 when the hourly limit is exhausted. */
  consume(userId: string): void {
    const now = Date.now();
    const cutoff = now - 60 * 60 * 1000;
    const times = (this.requestTimes.get(userId) ?? []).filter(
      (time) => time > cutoff,
    );
    if (times.length >= this.env.CHAT_REQUESTS_PER_USER_PER_HOUR) {
      throw new HttpException(
        {
          code: 'chat_quota_exceeded',
          message: `Chat limit of ${this.env.CHAT_REQUESTS_PER_USER_PER_HOUR} requests per hour reached`,
        },
        429,
      );
    }
    times.push(now);
    this.requestTimes.set(userId, times);
  }
}
