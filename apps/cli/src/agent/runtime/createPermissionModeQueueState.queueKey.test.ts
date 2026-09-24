import { describe, expect, it } from 'vitest';

import { createPermissionModeQueueState } from '@/agent/runtime/createPermissionModeQueueState';

describe('createPermissionModeQueueState (queue key)', () => {
  it('rebinds user-message delivery when the session client swaps', async () => {
    type QueuedTestMessage = {
      role: 'user';
      content: { type: 'text'; text: string };
      localId: string;
      meta: Record<string, never>;
    };
    type QueuedTestMessageHandler = (message: QueuedTestMessage) => void;

    let firstSessionHandler: QueuedTestMessageHandler | null = null;
    let secondSessionHandler: QueuedTestMessageHandler | null = null;

    const firstSession = {
      onUserMessage: (handler: QueuedTestMessageHandler) => {
        firstSessionHandler = handler;
      },
      updateMetadata: () => undefined,
      getMetadataSnapshot: () => ({}),
    };
    const secondSession = {
      onUserMessage: (handler: QueuedTestMessageHandler) => {
        secondSessionHandler = handler;
      },
      updateMetadata: () => undefined,
      getMetadataSnapshot: () => ({}),
    };

    const state = createPermissionModeQueueState({
      session: firstSession as any,
      initialPermissionMode: 'default' as any,
    } as any);

    state.rebindSession(secondSession as any);

    expect(secondSessionHandler).toBeTypeOf('function');
    const reboundHandler: QueuedTestMessageHandler =
      secondSessionHandler ??
      (() => {
        throw new Error('expected rebound session handler to be registered');
      });
    const swappedPrompt: QueuedTestMessage = {
      role: 'user',
      content: { type: 'text', text: 'swapped session prompt' },
      localId: 'local-swap-1',
      meta: {},
    };
    reboundHandler(swappedPrompt);

    const batch = await state.messageQueue.waitForMessagesAndGetAsString();
    expect(batch?.message.text).toBe('swapped session prompt');
  });

  it('allows callers to override restart batching via a queue key resolver', async () => {
    const session = {
      onUserMessage: () => undefined,
      updateMetadata: () => undefined,
      getMetadataSnapshot: () => ({}),
    };

    const { messageQueue } = createPermissionModeQueueState({
      session: session as any,
      initialPermissionMode: 'default' as any,
      // Treat all modes as equivalent for queue batching/restart purposes.
      resolvePermissionModeQueueKey: () => 'same',
    } as any);

    messageQueue.push({ text: 'one', localId: 'local-1' }, { permissionMode: 'default' as any });
    messageQueue.push({ text: 'two', localId: 'local-2' }, { permissionMode: 'yolo' as any });

    const batch = await messageQueue.waitForMessagesAndGetAsString();
    expect(batch?.message.text).toBe('one\ntwo');
  });

  it('keeps explicit append system prompts in separate batches', async () => {
    const session = {
      onUserMessage: () => undefined,
      updateMetadata: () => undefined,
      getMetadataSnapshot: () => ({}),
    };

    const { messageQueue } = createPermissionModeQueueState({
      session: session as any,
      initialPermissionMode: 'default' as any,
    } as any);

    messageQueue.push(
      { text: 'one', localId: 'local-1' },
      { permissionMode: 'default' as any, appendSystemPrompt: 'APPEND A' },
    );
    messageQueue.push(
      { text: 'two', localId: 'local-2' },
      { permissionMode: 'default' as any, appendSystemPrompt: 'APPEND B' },
    );

    const firstBatch = await messageQueue.waitForMessagesAndGetAsString();
    const secondBatch = await messageQueue.waitForMessagesAndGetAsString();

    expect(firstBatch?.message.text).toBe('one');
    expect(secondBatch?.message.text).toBe('two');
  });
});
