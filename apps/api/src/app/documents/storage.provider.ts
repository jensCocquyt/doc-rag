import type { Provider } from '@nestjs/common';
import type { ApiEnv } from '@doc-rag/config';
import { AzureBlobObjectStorage, ObjectStorage } from '@doc-rag/storage';
import { API_ENV } from '../env.provider';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export const objectStorageProvider: Provider = {
  provide: OBJECT_STORAGE,
  useFactory: (env: ApiEnv): ObjectStorage =>
    new AzureBlobObjectStorage({
      connectionString: env.AZURE_STORAGE_BLOB_CONNECTION_STRING,
      containerName: env.AZURE_STORAGE_BLOB_CONTAINER_ORIGINALS,
    }),
  inject: [API_ENV],
};
