import { QueueServiceClient } from '@azure/storage-queue';
import { QueueConsumer } from '../lib/queue-consumer';

// Requires the local infrastructure (pnpm infra:up) or the CI Compose services.
const connectionString = process.env['AZURE_STORAGE_QUEUE_CONNECTION_STRING'];

describe.skipIf(!connectionString)('QueueConsumer (Azurite)', () => {
  const runId = Date.now();
  const service = () =>
    QueueServiceClient.fromConnectionString(connectionString!);

  function makeConsumer(
    queueName: string,
    handler: (text: string, ctx: { dequeueCount: number }) => Promise<void>,
    overrides: Partial<ConstructorParameters<typeof QueueConsumer>[0]> = {},
  ): QueueConsumer {
    return new QueueConsumer({
      connectionString: connectionString!,
      queueName,
      poisonQueueName: `${queueName}-poison`,
      visibilityTimeoutSeconds: 1,
      maxDequeueCount: 3,
      pollIntervalMs: 100,
      backoffSeconds: () => 1,
      handler,
      ...overrides,
    });
  }

  async function setupQueue(name: string): Promise<void> {
    await service().getQueueClient(name).createIfNotExists();
    await service().getQueueClient(`${name}-poison`).createIfNotExists();
  }

  afterAll(async () => {
    for (const suffix of ['ok', 'retry', 'poison']) {
      const name = `it-consumer-${runId}-${suffix}`;
      await service().getQueueClient(name).deleteIfExists();
      await service().getQueueClient(`${name}-poison`).deleteIfExists();
    }
  });

  it('delivers a message once and deletes it on success', async () => {
    const queueName = `it-consumer-${runId}-ok`;
    await setupQueue(queueName);
    await service().getQueueClient(queueName).sendMessage('hello');

    const seen: string[] = [];
    const consumer = makeConsumer(queueName, async (text) => {
      seen.push(text);
    });
    expect(await consumer.pollOnce()).toBe(true);
    expect(seen).toEqual(['hello']);

    // Nothing left on the queue.
    expect(await consumer.pollOnce()).toBe(false);
  });

  it('redelivers after a failing attempt until the handler succeeds', async () => {
    const queueName = `it-consumer-${runId}-retry`;
    await setupQueue(queueName);
    await service().getQueueClient(queueName).sendMessage('flaky');

    const attempts: number[] = [];
    const consumer = makeConsumer(queueName, async (_text, ctx) => {
      attempts.push(ctx.dequeueCount);
      if (ctx.dequeueCount < 2) {
        throw new Error('transient failure');
      }
    });

    expect(await consumer.pollOnce()).toBe(true); // fails, schedules retry
    await waitFor(async () => consumer.pollOnce()); // succeeds on redelivery
    expect(attempts).toEqual([1, 2]);
  });

  it('moves a repeatedly failing message to the poison queue and reports it', async () => {
    const queueName = `it-consumer-${runId}-poison`;
    await setupQueue(queueName);
    await service().getQueueClient(queueName).sendMessage('bad');

    const poisoned: string[] = [];
    const consumer = makeConsumer(
      queueName,
      async () => {
        throw new Error('always fails');
      },
      {
        onPoison: async (text) => {
          poisoned.push(text);
        },
      },
    );

    // maxDequeueCount = 3: two failing deliveries, third moves to poison.
    expect(await consumer.pollOnce()).toBe(true);
    await waitFor(async () => consumer.pollOnce());
    await waitFor(async () => consumer.pollOnce());

    expect(poisoned).toEqual(['bad']);
    const poison = await service()
      .getQueueClient(`${queueName}-poison`)
      .receiveMessages();
    expect(poison.receivedMessageItems.map((m) => m.messageText)).toEqual([
      'bad',
    ]);
    // Original queue is empty.
    expect(await consumer.pollOnce()).toBe(false);
  });
});

/**
 * Retries an async predicate until truthy. Redeliveries depend on Azurite's
 * clock (backoff shortens visibility to >= 1s), so polling with patience
 * beats fixed sleeps.
 */
async function waitFor(
  attempt: () => Promise<boolean>,
  timeoutMs = 60000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await attempt()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('waitFor timed out');
}
