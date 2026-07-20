import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { ApiEnv } from '@doc-rag/config';
import type { EntraTokenVerifier } from '@doc-rag/auth';
import {
  POC_TENANT_ID,
  POC_USER_ID,
  type AuditRepository,
  type UserRepository,
} from '@doc-rag/database';
import { API_ENV } from '../env.provider';
import { AUDIT_REPOSITORY, USER_REPOSITORY } from '../core.module';
import { TOKEN_VERIFIER } from './tokens';

export interface RequestIdentity {
  tenantId: string;
  userId: string;
}

const IS_PUBLIC = 'isPublic';
/** Marks an endpoint as unauthenticated (health checks only). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Injects the authenticated identity attached by AuthGuard. */
export const Identity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestIdentity => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const identity = (request as { identity?: RequestIdentity }).identity;
    if (!identity) {
      throw new UnauthorizedException({
        code: 'unauthenticated',
        message: 'No authenticated identity on request',
      });
    }
    return identity;
  },
);

/**
 * AUTH_MODE=poc attaches the seeded identity (pre-Entra phases, local dev).
 * AUTH_MODE=entra requires a valid Bearer token; verified subjects map to
 * app users (first login provisions the user). Every authenticated request
 * carries a tenant-scoped identity — repositories never see un-scoped calls.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(TOKEN_VERIFIER)
    private readonly verifier: EntraTokenVerifier | null,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (this.env.AUTH_MODE === 'poc') {
      this.attach(request, { tenantId: POC_TENANT_ID, userId: POC_USER_ID });
      return true;
    }

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token || !this.verifier) {
      await this.auditFailure();
      throw new UnauthorizedException({
        code: 'unauthenticated',
        message: 'A Bearer token is required',
      });
    }
    try {
      const verified = await this.verifier.verify(token);
      // Single-tenant POC mapping: every verified user of the configured
      // Entra directory lands in the app tenant. Multi-tenant mapping would
      // resolve `tid` against a tenant directory instead.
      const tenantId = POC_TENANT_ID;
      let user = await this.users.findByExternalId(tenantId, verified.subject);
      user ??= await this.users.createFromExternalIdentity({
        tenantId,
        externalIdentityId: verified.subject,
        email: verified.email ?? `${verified.subject}@unknown.invalid`,
        displayName: verified.displayName ?? 'Unknown user',
      });
      this.attach(request, { tenantId, userId: user.id });
      return true;
    } catch {
      await this.auditFailure();
      throw new UnauthorizedException({
        code: 'invalid_token',
        message: 'Token validation failed',
      });
    }
  }

  private attach(request: FastifyRequest, identity: RequestIdentity): void {
    (request as { identity?: RequestIdentity }).identity = identity;
  }

  private async auditFailure(): Promise<void> {
    await this.audit
      .record({
        tenantId: null,
        userId: null,
        action: 'auth.failed',
        outcome: 'denied',
      })
      .catch(() => undefined);
  }
}
