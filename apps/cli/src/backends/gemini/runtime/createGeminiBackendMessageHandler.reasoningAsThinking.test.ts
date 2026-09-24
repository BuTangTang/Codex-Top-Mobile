import { describe, expect, it, vi } from 'vitest';

import { logger } from '@/ui/logger';
import { createTurnAssistantPreviewTracker } from '@/agent/runtime/turnAssistantPreviewTracker';
import { createGeminiBackendMessageHandler } from './createGeminiBackendMessageHandler';
import { createGeminiTurnMessageState } from './geminiTurnMessageState';
import { createSessionClientWithMetadata } from '@/testkit/backends/sessionFixtures';
import { createTestMetadata } from '@/testkit/backends/sessionMetadata';
import type { SessionTurnMutationV1 } from '@/api/session/mutations/sessionMutationTypes';
import { createSessionTurnLifecycle } from '@/agent/runtime/session/turn/lifecycle';

describe('createGeminiBackendMessageHandler (reasoning)', () => {
  it('tracks the current turn assistant preview from structured model output', () => {
    const state = createGeminiTurnMessageState();
    const tracker = createTurnAssistantPreviewTracker();
    const session = {
      sendAgentMessage: vi.fn(),
      keepAlive: vi.fn(),
    };
    const messageBuffer = {
      addMessage: vi.fn(),
      updateLastMessage: vi.fn(),
      removeLastMessage: vi.fn(),
    };

    const handler = createGeminiBackendMessageHandler({
      session: session as any,
      messageBuffer: messageBuffer as any,
      state,
      diffProcessor: {} as any,
      turnAssistantPreviewTracker: tracker,
    });

    handler({ type: 'model-output', textDelta: 'Hello' } as any);
    handler({ type: 'model-output', textDelta: ' world' } as any);

    expect(tracker.getPreview()).toBe('Hello world');
  });

  it('streams thinking chunks through transcript-vNext instead of durable thinking rows', () => {
    const state = createGeminiTurnMessageState();
    const session = {
      sendAgentMessage: vi.fn(),
      keepAlive: vi.fn(),
    };
    const messageBuffer = {
      addMessage: vi.fn(),
      updateLastMessage: vi.fn(),
    };

    const diffProcessor = {} as any;
    const transcriptStream = {
      appendThinkingDelta: vi.fn(),
      flushAll: vi.fn(),
    };

    const handler = createGeminiBackendMessageHandler({
      session: session as any,
      messageBuffer: messageBuffer as any,
      state,
      diffProcessor,
      transcriptStream: transcriptStream as any,
    });

    const text = '**Title**\n\nHello';
    handler({ type: 'event', name: 'thinking', payload: { text } } as any);
    handler({ type: 'status', status: 'idle' } as any);

    const calls = (session.sendAgentMessage as any).mock.calls as any[][];
    const toolCalls = calls.filter((c) => c?.[1]?.type === 'tool-call');
    expect(toolCalls).toEqual([]);

    const thinkingMessages = calls.filter((c) => c?.[1]?.type === 'thinking');
    expect(thinkingMessages).toEqual([]);
    expect(state.hadThinkingInTurn).toBe(true);
    expect(transcriptStream.appendThinkingDelta).toHaveBeenCalledWith(text);
  });

  it('clears thinking keepalive when the backend reports idle', () => {
    const state = createGeminiTurnMessageState();
    state.thinking = true;
    const session = {
      sendAgentMessage: vi.fn(),
      keepAlive: vi.fn(),
    };
    const messageBuffer = {
      addMessage: vi.fn(),
      updateLastMessage: vi.fn(),
    };

    const handler = createGeminiBackendMessageHandler({
      session: session as any,
      messageBuffer: messageBuffer as any,
      state,
      diffProcessor: {} as any,
    });

    handler({ type: 'status', status: 'idle' } as any);

    expect(state.thinking).toBe(false);
    expect(session.keepAlive).toHaveBeenCalledWith(false, 'remote');
  });

  it('records active Gemini status errors as failed runtime issues with issue details', async () => {
    const state = createGeminiTurnMessageState();
    state.thinking = true;
    const mutations: SessionTurnMutationV1[] = [];
    const sessionTurnLifecycle = createSessionTurnLifecycle({
      sessionId: 'happy-session-1',
      createId: () => 'turn-1',
      now: () => 123,
      enqueueSessionTurn: async (mutation) => {
        mutations.push(mutation);
      },
    });
    const session = {
      sendAgentMessage: vi.fn(),
      keepAlive: vi.fn(),
      sessionTurnLifecycle,
      getLastObservedMessageSeq: vi.fn(() => 42),
    };
    const messageBuffer = {
      addMessage: vi.fn(),
      updateLastMessage: vi.fn(),
    };

    const handler = createGeminiBackendMessageHandler({
      session: session as any,
      messageBuffer: messageBuffer as any,
      state,
      diffProcessor: {} as any,
    });

    handler({
      type: 'status',
      status: 'error',
      detail: { message: 'Gemini quota exhausted until reset' },
    } as any);
    await Promise.resolve();

    expect(session.sendAgentMessage).not.toHaveBeenCalledWith('gemini', expect.objectContaining({ type: 'turn_failed' }));
    expect(session.sendAgentMessage).not.toHaveBeenCalledWith('gemini', expect.objectContaining({ type: 'turn_aborted' }));
    await expect.poll(() => mutations).toEqual([
      expect.objectContaining({
        action: 'begin',
        turnId: 'session-turn:turn-1',
        provider: 'gemini',
      }),
      expect.objectContaining({
        action: 'fail',
        turnId: 'session-turn:turn-1',
        provider: 'gemini',
        issue: expect.objectContaining({
          source: 'usage_limit',
          provider: 'gemini',
          sessionSeq: 42,
          usageLimit: expect.objectContaining({
            resetAtMs: null,
            retryAfterMs: null,
          }),
        }),
      }),
    ]);
  });

  it('tracks permission responses as turn activity', () => {
    const state = createGeminiTurnMessageState();
    const session = {
      sendAgentMessage: vi.fn(),
      keepAlive: vi.fn(),
    };
    const messageBuffer = {
      addMessage: vi.fn(),
      updateLastMessage: vi.fn(),
    };

    const handler = createGeminiBackendMessageHandler({
      session: session as any,
      messageBuffer: messageBuffer as any,
      state,
      diffProcessor: {} as any,
    });

    handler({ type: 'permission-response', id: 'permission-1', approved: true } as any);

    expect(state.hadPermissionInTurn).toBe(true);
  });

  it('flushes streamed thinking before forwarding a Gemini tool-call boundary', () => {
    const state = createGeminiTurnMessageState();
    const session = {
      sendAgentMessage: vi.fn(),
      keepAlive: vi.fn(),
    };
    const messageBuffer = {
      addMessage: vi.fn(),
      updateLastMessage: vi.fn(),
    };
    const diffProcessor = {} as any;
    const transcriptStream = {
      appendThinkingDelta: vi.fn(),
      flushAll: vi.fn(),
    };

    const handler = createGeminiBackendMessageHandler({
      session: session as any,
      messageBuffer: messageBuffer as any,
      state,
      diffProcessor,
      transcriptStream: transcriptStream as any,
    });

    handler({ type: 'event', name: 'thinking', payload: { text: 'Investigating' } } as any);
    handler({ type: 'tool-call', toolName: 'glob', callId: 'call_1', args: { pattern: '*.ts' } } as any);

    expect(transcriptStream.flushAll).toHaveBeenCalledWith({ reason: 'tool-call-boundary' });
  });

  it('logs and swallows transcript flush failures at tool-call boundaries', async () => {
    const state = createGeminiTurnMessageState();
    const session = {
      sendAgentMessage: vi.fn(),
      keepAlive: vi.fn(),
    };
    const messageBuffer = {
      addMessage: vi.fn(),
      updateLastMessage: vi.fn(),
    };
    const diffProcessor = {} as any;
    const flushFailure = Promise.reject(new Error('flush failed'));
    flushFailure.catch(() => {});
    const transcriptStream = {
      appendThinkingDelta: vi.fn(),
      flushAll: vi.fn(() => flushFailure),
    };
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

    try {
      const handler = createGeminiBackendMessageHandler({
        session: session as any,
        messageBuffer: messageBuffer as any,
        state,
        diffProcessor,
        transcriptStream: transcriptStream as any,
      });

      handler({ type: 'tool-call', toolName: 'glob', callId: 'call_1', args: { pattern: '*.ts' } } as any);
      await Promise.resolve();

      expect(session.sendAgentMessage).toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith('[gemini] Failed to flush streamed thinking at tool-call boundary', expect.any(Error));
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('publishes Gemini ACP session model state into session metadata', () => {
    const state = createGeminiTurnMessageState();
    const { session, getMetadata } = createSessionClientWithMetadata({
      initialMetadata: createTestMetadata(),
    });
    const messageBuffer = {
      addMessage: vi.fn(),
      updateLastMessage: vi.fn(),
    };

    const handler = createGeminiBackendMessageHandler({
      session: session as any,
      messageBuffer: messageBuffer as any,
      state,
      diffProcessor: {} as any,
    });

    handler({
      type: 'event',
      name: 'session_models_state',
      payload: {
        currentModelId: 'auto-gemini-3',
        availableModels: [
          { id: 'auto-gemini-3', name: 'Auto' },
          {
            modelId: 'gemini-3-pro-preview',
            name: 'Gemini 3 Pro Preview',
            description: 'Preview',
            modelOptions: [
              {
                id: 'reasoning_effort',
                name: 'Reasoning effort',
                description: 'Reasoning depth',
                type: 'select',
                currentValue: 'high',
                options: [
                  { value: 'medium', name: 'Medium' },
                  { value: 'high', name: 'High', description: 'More reasoning' },
                ],
              },
            ],
          },
        ],
      },
    } as any);

    expect(getMetadata().acpSessionModelsV1).toMatchObject({
      v: 1,
      provider: 'gemini',
      currentModelId: 'auto-gemini-3',
      availableModels: [
        { id: 'auto-gemini-3', name: 'Auto' },
        {
          id: 'gemini-3-pro-preview',
          name: 'Gemini 3 Pro Preview',
          description: 'Preview',
          modelOptions: [
            {
              id: 'reasoning_effort',
              name: 'Reasoning effort',
              description: 'Reasoning depth',
              type: 'select',
              currentValue: 'high',
              options: [
                { value: 'medium', name: 'Medium' },
                { value: 'high', name: 'High', description: 'More reasoning' },
              ],
            },
          ],
        },
      ],
    });
  });
});
