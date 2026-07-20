import { Global, Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import {
  DrizzleAuditRepository,
  DrizzleUserRepository,
  type AuditRepository,
  type UserRepository,
} from '@doc-rag/database';
import { apiEnvProvider, API_ENV } from './env.provider';
import {
  DatabaseClient,
  DOCUMENT_REPOSITORY,
  DOCUMENT_VERSION_REPOSITORY,
  INGESTION_JOB_REPOSITORY,
  repositoryProviders,
} from './documents/database.provider';
import { objectStorageProvider, OBJECT_STORAGE } from './documents/storage.provider';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

const providers: Provider[] = [
  apiEnvProvider,
  DatabaseClient,
  ...repositoryProviders,
  objectStorageProvider,
  {
    provide: USER_REPOSITORY,
    useFactory: (client: DatabaseClient): UserRepository =>
      new DrizzleUserRepository(client.db),
    inject: [DatabaseClient],
  },
  {
    provide: AUDIT_REPOSITORY,
    useFactory: (client: DatabaseClient): AuditRepository =>
      new DrizzleAuditRepository(client.db),
    inject: [DatabaseClient],
  },
];

/**
 * Single instances of env, database pool, repositories and storage for the
 * whole application (one pg pool per process). Global: feature modules use
 * the tokens without re-providing them.
 */
@Global()
@Module({
  providers,
  exports: [
    API_ENV,
    DatabaseClient,
    DOCUMENT_REPOSITORY,
    DOCUMENT_VERSION_REPOSITORY,
    INGESTION_JOB_REPOSITORY,
    OBJECT_STORAGE,
    USER_REPOSITORY,
    AUDIT_REPOSITORY,
  ],
})
export class CoreModule {}
