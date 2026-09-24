import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  followers: [] as Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    opts: { onJson: (value: unknown) => void | Promise<void> };
  }>,
  resolveStart: null as (() => void) | null,
  operationLog: [] as string[],
  appendAfterFlushCount: 0,
  rolloutFiles: [] as Array<{ filePath: string }>,
}));

vi.mock('@/agent/localControl/jsonlFollower', () => ({
  JsonlFollower: class MockJsonlFollower {},
}));

vi.mock('@/agent/localControl/jsonlFollowController', () => ({
  createJsonlFollowController: (opts: { onJson: (value: unknown) => void | Promise<void>; onClosed?: () => void }) => {
    let controllerState: 'idle' | 'active' | 'completed' | 'closed' = 'idle';
    const controller = {
      start: vi.fn(
        () => {
          controllerState = 'active';
          return new Promise<void>((resolve) => {
            state.resolveStart = resolve;
          });
        },
      ),
      stop: vi.fn(async () => {
        controllerState = 'closed';
        opts.onClosed?.();
      }),
      markCompleted: vi.fn(() => {
        controllerState = 'completed';
        opts.onClosed?.();
      }),
      markIdle: vi.fn(() => {
        controllerState = 'idle';
      }),
      getState: vi.fn(() => controllerState),
    };
    state.followers.push({
      start: controller.start,
      stop: controller.stop,
      markCompleted: controller.markCompleted,
      getState: controller.getState,
      opts,
    });
    return controller;
  },
}));

vi.mock('../../directSessions/collectCodexSessionRolloutFiles', () => ({
  collectCodexSessionRolloutFiles: vi.fn(async () => state.rolloutFiles),
}));

vi.mock('@/api/session/streamedTranscriptWriter', () => ({
  createStreamedTranscriptWriter: () => ({
    appendAssistantDelta: (text: string) => {
      state.operationLog.push(`append:${text}`);
      if (state.operationLog.includes('flush:turn-end')) {
        state.appendAfterFlushCount += 1;
      }
    },
    appendThinkingDelta: () => {},
    flushAll: vi.fn(async (opts: { reason: 'tool-call-boundary' | 'turn-end' | 'abort' }) => {
      state.operationLog.push(`flush:${opts.reason}`);
    }),
  }),
}));

import { CodexRolloutMirror } from '../codexRolloutMirror';

async function waitForPendingStart(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (state.resolveStart) return;
    await Promise.resolve();
  }
  throw new Error('Expected a pending follower start');
}

describe('CodexRolloutMirror lifecycle', () => {
  beforeEach(() => {
    state.followers.length = 0;
    state.resolveStart = null;
    state.operationLog.length = 0;
    state.appendAfterFlushCount = 0;
    state.rolloutFiles.length = 0;
  });

  it('stops follower if stop is called while start is still pending', async () => {
    const mirror = new CodexRolloutMirror({
      filePath: '/tmp/mock.jsonl',
      debug: false,
      onCodexSessionId: () => {},
      session: {
        sendUserTextMessage: () => {},
        sendCodexMessage: () => {},
        sendSessionEvent: () => {},
      } as any,
    });

    const startPromise = mirror.start();
    await Promise.resolve();

    expect(state.followers).toHaveLength(1);
    const follower = state.followers[0];

    const stopPromise = mirror.stop();
    expect(follower.stop).toHaveBeenCalledTimes(1);

    state.resolveStart?.();
    await Promise.all([startPromise, stopPromise]);

    expect(follower.stop).toHaveBeenCalledTimes(2);
  });

  it('stops the follower before the final transcript flush', async () => {
    const mirror = new CodexRolloutMirror({
      filePath: '/tmp/mock.jsonl',
      debug: false,
      onCodexSessionId: () => {},
      session: {
        sendUserTextMessage: () => {},
        sendCodexMessage: () => {},
        sendSessionEvent: () => {},
      } as any,
    });

    const startPromise = mirror.start();
    await Promise.resolve();
    state.resolveStart?.();
    await startPromise;

    expect(state.followers).toHaveLength(1);
    const follower = state.followers[0];
    follower.stop.mockImplementationOnce(async () => {
      state.operationLog.push('stop:start');
      await follower.opts.onJson({
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'late delta' }] },
      });
      state.operationLog.push('stop:end');
    });

    await mirror.stop();

    expect(state.appendAfterFlushCount).toBe(0);
    expect(state.operationLog).toEqual(['stop:start', 'append:late delta', 'stop:end', 'flush:turn-end']);
  });

  it('retains closed subagent ids without keeping child follower resources alive', async () => {
    state.rolloutFiles.push({ filePath: '/tmp/codex-child.jsonl' });
    const mirror = new CodexRolloutMirror({
      filePath: '/tmp/mock.jsonl',
      codexHome: '/tmp/codex-home',
      debug: false,
      onCodexSessionId: () => {},
      session: {
        sendUserTextMessage: () => {},
        sendCodexMessage: () => {},
        sendAgentMessage: () => {},
        sendSessionEvent: () => {},
      } as any,
    });

    const spawn = (mirror as any).onJson({
      type: 'event_msg',
      payload: {
        type: 'collab_agent_spawn_end',
        new_thread_id: 'child-thread',
        prompt: 'inspect',
      },
    });
    await waitForPendingStart();
    state.resolveStart?.();
    await spawn;

    expect(state.followers).toHaveLength(1);

    await (mirror as any).onJson({
      type: 'event_msg',
      payload: {
        type: 'collab_waiting_end',
        agent_statuses: [
          {
            thread_id: 'child-thread',
            status: { completed: 'done' },
          },
        ],
      },
    });

    expect(state.followers[0]?.markCompleted).toHaveBeenCalledTimes(1);

    await (mirror as any).onJson({
      type: 'event_msg',
      payload: {
        type: 'collab_agent_spawn_end',
        new_thread_id: 'child-thread',
        prompt: 'inspect again',
      },
    });

    expect(state.followers).toHaveLength(1);
  });
});
