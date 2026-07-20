import { Database } from '../client';
import { auditEvents } from '../schema';

export interface AuditEventInput {
  tenantId: string | null;
  userId: string | null;
  action:
    | 'document.upload'
    | 'document.delete'
    | 'conversation.create'
    | 'chat.request'
    | 'auth.failed';
  resourceType?: string;
  resourceId?: string;
  outcome?: 'success' | 'denied' | 'failed';
}

export interface AuditRepository {
  record(event: AuditEventInput): Promise<void>;
}

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly db: Database) {}

  async record(event: AuditEventInput): Promise<void> {
    await this.db.insert(auditEvents).values({
      tenantId: event.tenantId,
      userId: event.userId,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      outcome: event.outcome ?? 'success',
    });
  }
}
