import type { Provider } from '@nestjs/common';
import { loadApiEnv } from '@doc-rag/config';
import type { ApiEnv } from '@doc-rag/config';

export const API_ENV = Symbol('API_ENV');

export const apiEnvProvider: Provider = {
  provide: API_ENV,
  useFactory: (): ApiEnv => loadApiEnv(),
};
