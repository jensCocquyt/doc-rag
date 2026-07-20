import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import type { Pool } from 'pg';
import type { ApiEnv } from '@doc-rag/config';
import {
  createDatabase,
  createPool,
  Database,
  DocumentRepository,
  DocumentVersionRepository,
  DrizzleDocumentRepository,
  DrizzleDocumentVersionRepository,
  DrizzleIngestionJobRepository,
  IngestionJobRepository,
} from '@doc-rag/database';
import { API_ENV } from '../env.provider';

@Injectable()
export class DatabaseClient implements OnModuleDestroy {
  readonly db: Database;
  private readonly pool: Pool;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.pool = createPool(env.DATABASE_URL);
    this.db = createDatabase(this.pool);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

export const DOCUMENT_REPOSITORY = Symbol('DOCUMENT_REPOSITORY');
export const DOCUMENT_VERSION_REPOSITORY = Symbol(
  'DOCUMENT_VERSION_REPOSITORY',
);
export const INGESTION_JOB_REPOSITORY = Symbol('INGESTION_JOB_REPOSITORY');

export const repositoryProviders: Provider[] = [
  {
    provide: DOCUMENT_REPOSITORY,
    useFactory: (client: DatabaseClient): DocumentRepository =>
      new DrizzleDocumentRepository(client.db),
    inject: [DatabaseClient],
  },
  {
    provide: DOCUMENT_VERSION_REPOSITORY,
    useFactory: (client: DatabaseClient): DocumentVersionRepository =>
      new DrizzleDocumentVersionRepository(client.db),
    inject: [DatabaseClient],
  },
  {
    provide: INGESTION_JOB_REPOSITORY,
    useFactory: (client: DatabaseClient): IngestionJobRepository =>
      new DrizzleIngestionJobRepository(client.db),
    inject: [DatabaseClient],
  },
];
