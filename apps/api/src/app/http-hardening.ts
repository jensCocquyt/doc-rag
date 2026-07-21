import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiEnv } from '@doc-rag/config';

/** Adapter with the request-size cap and correlation-id generator. */
export function createHardenedAdapter(env: ApiEnv): FastifyAdapter {
  return new FastifyAdapter({
    // JSON-only API: file bytes go browser → storage, never through here.
    bodyLimit: env.MAX_REQUEST_BODY_BYTES,
    genReqId: () => randomUUID(),
  });
}

/**
 * Response correlation header + blunt per-client flood protection (the
 * per-user chat quota is separate, in ChatQuotaService). Shared between the
 * real bootstrap and integration tests so hardening is testable.
 */
export async function registerHttpHardening(
  app: NestFastifyApplication,
): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  await fastify.register(rateLimit, { max: 300, timeWindow: '1 minute' });
}
