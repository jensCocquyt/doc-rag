import { QueueServiceClient } from '@azure/storage-queue';
import { readIntegrationEnv } from '../lib/integration-env';

const env = readIntegrationEnv();

describe.skipIf(!env)('Queue Storage round-trip (Azurite)', () => {
  const queueName = `it-queue-${Date.now()}`;

  it('creates a queue, sends and receives a message, then cleans up', async () => {
    const service = QueueServiceClient.fromConnectionString(
      env!.queueConnectionString,
    );
    const queue = service.getQueueClient(queueName);
    await queue.create();
    try {
      const payload = JSON.stringify({ kind: 'phase-0-fixture' });
      await queue.sendMessage(payload);

      const received = await queue.receiveMessages({
        numberOfMessages: 1,
        visibilityTimeout: 10,
      });
      expect(received.receivedMessageItems).toHaveLength(1);
      const message = received.receivedMessageItems[0];
      expect(message.messageText).toBe(payload);

      await queue.deleteMessage(message.messageId, message.popReceipt);
    } finally {
      await queue.delete();
    }
  });
});
