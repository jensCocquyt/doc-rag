import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { loadApiEnv, loadDotenv } from '@doc-rag/config';
import { AppModule } from './app/app.module';

async function bootstrap() {
  loadDotenv();
  const env = loadApiEnv();
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
