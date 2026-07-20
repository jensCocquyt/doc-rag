import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { loadApiEnv, loadDotenv } from '@doc-rag/config';
import { configureDevelopmentCors } from '@doc-rag/storage';
import { AppModule } from './app/app.module';

async function bootstrap() {
  loadDotenv();
  const env = loadApiEnv();
  if (env.NODE_ENV === 'development') {
    // Lets the browser PUT directly to Azurite. Azure storage-account CORS is
    // configured in Bicep during the deployment phase, not here. Best-effort:
    // the API must still boot (degraded) when Azurite is down, like /health.
    await configureDevelopmentCors(
      env.AZURE_STORAGE_BLOB_CONNECTION_STRING,
    ).catch((error) =>
      Logger.warn(
        `Could not configure Azurite CORS (is the infrastructure up?): ${
          error instanceof Error ? error.message : error
        }`,
      ),
    );
  }
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableShutdownHooks();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  Logger.log(`API listening on http://localhost:${env.PORT}`);
}

bootstrap().catch((error) => {
  Logger.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
