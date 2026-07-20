import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export interface VerifiedIdentity {
  /** Entra object/subject id — stable per user per tenant. */
  subject: string;
  /** Entra directory (tenant) id. */
  entraTenantId: string;
  email: string | null;
  displayName: string | null;
}

export class TokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

export interface TokenVerifierOptions {
  /** Entra directory expected to issue tokens. */
  tenantId: string;
  /** Audience of the API app registration (its client id or api:// URI). */
  audience: string;
  /**
   * Key resolver override for tests (jose createLocalJWKSet). Defaults to
   * the tenant's remote JWKS endpoint.
   */
  getKey?: JWTVerifyGetKey;
  /** Issuer override for tests; defaults to the v2.0 Entra issuer. */
  issuer?: string;
}

/**
 * Validates Entra ID (v2.0) access tokens: signature against the tenant
 * JWKS, issuer, audience and lifetime. No claim is trusted before this
 * passes (PLAN.md Phase 9).
 */
export class EntraTokenVerifier {
  private readonly getKey: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(options: TokenVerifierOptions) {
    this.issuer =
      options.issuer ??
      `https://login.microsoftonline.com/${options.tenantId}/v2.0`;
    this.audience = options.audience;
    this.getKey =
      options.getKey ??
      createRemoteJWKSet(
        new URL(
          `https://login.microsoftonline.com/${options.tenantId}/discovery/v2.0/keys`,
        ),
      );
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.getKey, {
        issuer: this.issuer,
        audience: this.audience,
      }));
    } catch (error) {
      throw new TokenVerificationError(
        error instanceof Error ? error.message : 'Token verification failed',
      );
    }
    const subject = payload.sub;
    const entraTenantId = payload['tid'];
    if (typeof subject !== 'string' || typeof entraTenantId !== 'string') {
      throw new TokenVerificationError('Token lacks sub or tid claims');
    }
    const email = payload['preferred_username'] ?? payload['email'];
    const name = payload['name'];
    return {
      subject,
      entraTenantId,
      email: typeof email === 'string' ? email : null,
      displayName: typeof name === 'string' ? name : null,
    };
  }
}
