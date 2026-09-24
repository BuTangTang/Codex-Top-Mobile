import { describe, expect, it, vi } from 'vitest';
import type { DirectTranscriptRawMessageV1, DirectSessionObservationV1 } from '@happier-dev/protocol';
import { createManagedDirectSessionFollowLease } from './createManagedDirectSessionFollowLease';

type TranscriptUpdate = Readonly<{
  items: Iterable<DirectTranscriptRawMessageV1>;
  fromCursor?: string | null;
  nextCursor?: string | null;
  truncated: boolean;
  truncationReason?: 'page_limit' | 'source_discontinuity';
}>;

type TranscriptUpdateListener = (update: TranscriptUpdate) => void | Promise<void>;

const directMessage = {
  id: 'direct-2',
  createdAtMs: 1_050,
  localId: 'direct-local-2',
  raw: {
    type: 'assistant',
    uuid: 'direct-2',
    message: { model: 'm', content: [{ type: 'text', text: 'hello from push' }] },
  },
} satisfies DirectTranscriptRawMessageV1;

describe('createManagedDirectSessionFollowLease', () => {
  it('reads current provider observation immediately without waiting for transcript processing', async () => {
    let observation: DirectSessionObservationV1 = { v: 1, source: 'desktop', turnId: 'current', state: 'running' };
    let finishRelease!: () => void;
    const lease = await createManagedDirectSessionFollowLease({
      sessionId: 's', reason: 'attached_view', shouldProcessBackgroundFollowEffects: () => false,
      acquireProviderFollowLease: async () => ({
        getObservation: () => observation,
        subscribeToTranscriptUpdates: () => () => {},
        release: () => new Promise<void>((resolve) => { finishRelease = resolve; }),
      }),
    });
    expect(lease?.getObservation?.()).toEqual(observation);
    observation = { v: 1, state: 'unknown', reason: 'connection_closed' };
    expect(lease?.getObservation?.()).toEqual(observation);
    observation = { v: 1, source: 'desktop', turnId: 'current', state: 'completed' };
    const releasing = lease!.release();
    expect(lease?.getObservation?.()).toMatchObject({ state: 'unknown' });
    finishRelease();
    await releasing;
  });
  it.each([true, false])('emits direct-session transcript page-limit metadata with legacy truncated=%s', async (truncated) => {
    const listeners: TranscriptUpdateListener[] = [];
    const emitDirectSessionTranscriptUpdate = vi.fn();

    const lease = await createManagedDirectSessionFollowLease({
      sessionId: 'sess-managed-follow',
      reason: 'attached_view',
      acquireProviderFollowLease: async () => ({
        release: async () => {},
        subscribeToTranscriptUpdates: (nextListener: TranscriptUpdateListener) => {
          listeners.push(nextListener);
          return () => {
            listeners.length = 0;
          };
        },
      }),
      emitDirectSessionTranscriptUpdate,
      shouldProcessBackgroundFollowEffects: () => false,
    });

    expect(lease).not.toBeNull();
    const currentListener = listeners[0];
    expect(currentListener).toEqual(expect.any(Function));
    if (!currentListener) {
      throw new Error('expected transcript update listener');
    }

    await currentListener({
      items: new Set([directMessage]),
      fromCursor: 'cursor-1',
      nextCursor: 'cursor-2',
      truncated,
      truncationReason: 'page_limit',
    });

    expect(emitDirectSessionTranscriptUpdate).toHaveBeenCalledWith({
      type: 'direct-session-transcript-delta',
      sessionId: 'sess-managed-follow',
      items: [directMessage],
      fromCursor: 'cursor-1',
      nextCursor: 'cursor-2',
      truncated,
      truncationReason: 'page_limit',
    });
  });

  it('swallows transcript delta emit failures and keeps provider lease cleanup idempotent', async () => {
    const listeners: TranscriptUpdateListener[] = [];
    const release = vi.fn(async () => {});
    const unsubscribe = vi.fn();
    const emitDirectSessionTranscriptUpdate = vi.fn(() => {
      throw new Error('socket unavailable');
    });

    const lease = await createManagedDirectSessionFollowLease({
      sessionId: 'sess-managed-follow',
      reason: 'background_follow',
      acquireProviderFollowLease: async () => ({
        release,
        subscribeToTranscriptUpdates: (nextListener: TranscriptUpdateListener) => {
          listeners.push(nextListener);
          return unsubscribe;
        },
      }),
      emitDirectSessionTranscriptUpdate,
      shouldProcessBackgroundFollowEffects: () => true,
    });

    expect(lease).not.toBeNull();
    const currentListener = listeners[0];
    expect(currentListener).toEqual(expect.any(Function));
    if (!currentListener) {
      throw new Error('expected transcript update listener');
    }

    await expect(currentListener({
      items: [directMessage],
      nextCursor: null,
      truncated: true,
    })).resolves.toBeUndefined();

    await lease?.release();
    await lease?.release();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('forwards discontinuity control frames without running background message side effects', async () => {
    const listeners: TranscriptUpdateListener[] = [];
    const emitDirectSessionTranscriptUpdate = vi.fn();
    await createManagedDirectSessionFollowLease({
      sessionId: 'sess-managed-follow',
      reason: 'background_follow',
      acquireProviderFollowLease: async () => ({
        release: async () => {},
        subscribeToTranscriptUpdates: (listener: TranscriptUpdateListener) => {
          listeners.push(listener);
          return () => {};
        },
      }),
      emitDirectSessionTranscriptUpdate,
      shouldProcessBackgroundFollowEffects: () => true,
    });

    await listeners[0]?.({
      items: [directMessage],
      fromCursor: 'stale-cursor',
      nextCursor: 'replacement-tail',
      truncated: true,
      truncationReason: 'source_discontinuity',
    });

    expect(emitDirectSessionTranscriptUpdate).toHaveBeenCalledTimes(1);
  });

  it('suppresses detached metadata and ready notifications while background-follow effects are disabled', async () => {
    const listeners: TranscriptUpdateListener[] = [];
    const emitDirectSessionTranscriptUpdate = vi.fn(async () => {});

    await createManagedDirectSessionFollowLease({
      sessionId: 'sess-managed-follow',
      reason: 'background_follow',
      acquireProviderFollowLease: async () => ({
        release: async () => {},
        subscribeToTranscriptUpdates: (nextListener: TranscriptUpdateListener) => {
          listeners.push(nextListener);
          return () => {};
        },
      }),
      emitDirectSessionTranscriptUpdate,
      shouldProcessBackgroundFollowEffects: () => false,
    });

    const currentListener = listeners[0];
    expect(currentListener).toEqual(expect.any(Function));
    if (!currentListener) {
      throw new Error('expected transcript update listener');
    }

    await currentListener({
      items: [directMessage],
      fromCursor: 'cursor-current',
      nextCursor: 'cursor-suppressed',
      truncated: false,
    });

    expect(emitDirectSessionTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess-managed-follow',
      fromCursor: 'cursor-current',
      nextCursor: 'cursor-suppressed',
    }));
  });
});
