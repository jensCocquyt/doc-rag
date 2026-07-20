import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  EntraTokenVerifier,
  TokenVerificationError,
} from './token-verifier';

const TENANT = '11111111-1111-1111-1111-111111111111';
const AUDIENCE = 'api://docrag-api';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

describe('EntraTokenVerifier', () => {
  let verifier: EntraTokenVerifier;
  let sign: (claims?: Record<string, unknown>, opts?: {
    audience?: string;
    issuer?: string;
    expired?: boolean;
  }) => Promise<string>;
  let signWithOtherKey: () => Promise<string>;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key';
    verifier = new EntraTokenVerifier({
      tenantId: TENANT,
      audience: AUDIENCE,
      getKey: createLocalJWKSet({ keys: [jwk] }),
    });
    sign = async (claims = {}, opts = {}) =>
      new SignJWT({
        tid: TENANT,
        preferred_username: 'user@example.com',
        name: 'Test User',
        ...claims,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setSubject('subject-1')
        .setIssuer(opts.issuer ?? ISSUER)
        .setAudience(opts.audience ?? AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(opts.expired ? '-1h' : '1h')
        .sign(privateKey);
    signWithOtherKey = async () => {
      const other = await generateKeyPair('RS256');
      return new SignJWT({ tid: TENANT })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setSubject('subject-1')
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(other.privateKey);
    };
  });

  it('accepts a valid token and extracts the identity', async () => {
    const identity = await verifier.verify(await sign());
    expect(identity).toEqual({
      subject: 'subject-1',
      entraTenantId: TENANT,
      email: 'user@example.com',
      displayName: 'Test User',
    });
  });

  it('rejects a token with the wrong audience', async () => {
    await expect(
      verifier.verify(await sign({}, { audience: 'api://other' })),
    ).rejects.toThrow(TokenVerificationError);
  });

  it('rejects a token from the wrong issuer', async () => {
    await expect(
      verifier.verify(
        await sign({}, { issuer: 'https://evil.example.com/v2.0' }),
      ),
    ).rejects.toThrow(TokenVerificationError);
  });

  it('rejects an expired token', async () => {
    await expect(
      verifier.verify(await sign({}, { expired: true })),
    ).rejects.toThrow(TokenVerificationError);
  });

  it('rejects a token signed with an unknown key', async () => {
    await expect(verifier.verify(await signWithOtherKey())).rejects.toThrow(
      TokenVerificationError,
    );
  });

  it('rejects a token without tid', async () => {
    await expect(
      verifier.verify(await sign({ tid: undefined })),
    ).rejects.toThrow(TokenVerificationError);
  });

  it('rejects garbage', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toThrow(
      TokenVerificationError,
    );
  });
});
