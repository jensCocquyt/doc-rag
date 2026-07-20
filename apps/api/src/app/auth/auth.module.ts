import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Provider } from '@nestjs/common';
import type { ApiEnv } from '@doc-rag/config';
import { EntraTokenVerifier } from '@doc-rag/auth';
import { API_ENV } from '../env.provider';
import { AuthGuard } from './auth.guard';
import { TOKEN_VERIFIER } from './tokens';

export { TOKEN_VERIFIER };

const providers: Provider[] = [
  {
    provide: TOKEN_VERIFIER,
    useFactory: (env: ApiEnv): EntraTokenVerifier | null =>
      env.AUTH_MODE === 'entra'
        ? new EntraTokenVerifier({
            tenantId: env.ENTRA_TENANT_ID as string,
            audience: env.ENTRA_API_AUDIENCE as string,
          })
        : null,
    inject: [API_ENV],
  },
  { provide: APP_GUARD, useClass: AuthGuard },
];

@Module({
  providers,
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}
