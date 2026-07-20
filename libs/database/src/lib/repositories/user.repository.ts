import { and, eq } from 'drizzle-orm';
import { Database } from '../client';
import { users } from '../schema';

export type UserRecord = typeof users.$inferSelect;

export interface UserRepository {
  findByExternalId(
    tenantId: string,
    externalIdentityId: string,
  ): Promise<UserRecord | null>;
  /** First-login provisioning: maps a verified Entra identity to an app user. */
  createFromExternalIdentity(input: {
    tenantId: string;
    externalIdentityId: string;
    email: string;
    displayName: string;
  }): Promise<UserRecord>;
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findByExternalId(
    tenantId: string,
    externalIdentityId: string,
  ): Promise<UserRecord | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.externalIdentityId, externalIdentityId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async createFromExternalIdentity(input: {
    tenantId: string;
    externalIdentityId: string;
    email: string;
    displayName: string;
  }): Promise<UserRecord> {
    const [row] = await this.db.insert(users).values(input).returning();
    return row;
  }
}
