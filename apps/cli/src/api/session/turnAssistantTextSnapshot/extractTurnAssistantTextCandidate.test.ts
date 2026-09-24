import { describe, expect, it } from 'vitest';

import { extractTurnAssistantTextFromSessionContent } from './extractTurnAssistantTextCandidate';

describe('extractTurnAssistantTextFromSessionContent', () => {
  it('extracts root ACP assistant message text', () => {
    expect(extractTurnAssistantTextFromSessionContent({
      role: 'agent',
      content: {
        type: 'acp',
        provider: 'qwen',
        data: { type: 'message', message: 'Done.' },
      },
    })).toEqual({
      text: 'Done.',
      provider: 'qwen',
      sidechainId: null,
    });
  });

  it('returns sidechain metadata so the snapshot store can ignore non-root text', () => {
    expect(extractTurnAssistantTextFromSessionContent({
      role: 'agent',
      content: {
        type: 'acp',
        provider: 'claude',
        data: { type: 'message', message: 'Nested answer', sidechainId: 'agent-1' },
      },
    })).toEqual({
      text: 'Nested answer',
      provider: 'claude',
      sidechainId: 'agent-1',
    });
  });

  it('ignores ACP thinking and tool records', () => {
    expect(extractTurnAssistantTextFromSessionContent({
      role: 'agent',
      content: {
        type: 'acp',
        provider: 'opencode',
        data: { type: 'thinking', text: 'Working...' },
      },
    })).toBeNull();
    expect(extractTurnAssistantTextFromSessionContent({
      role: 'agent',
      content: {
        type: 'acp',
        provider: 'opencode',
        data: { type: 'tool-call', name: 'read' },
      },
    })).toBeNull();
  });

  it('extracts Claude assistant text blocks and ignores task sidechain output', () => {
    expect(extractTurnAssistantTextFromSessionContent({
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'First' },
              { type: 'tool_use', name: 'Read' },
              { type: 'text', text: 'Second' },
            ],
          },
        },
      },
    })?.text).toBe('First\n\nSecond');

    expect(extractTurnAssistantTextFromSessionContent({
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'assistant',
          parent_tool_use_id: 'toolu_1',
          message: { content: [{ type: 'text', text: 'Nested' }] },
        },
      },
    })).toBeNull();
  });

  it('extracts Codex assistant message text', () => {
    expect(extractTurnAssistantTextFromSessionContent({
      role: 'agent',
      content: {
        type: 'codex',
        data: { type: 'agent_message', message: 'Codex answer' },
      },
    })).toEqual({
      text: 'Codex answer',
      provider: 'codex',
      sidechainId: null,
    });
  });
});
