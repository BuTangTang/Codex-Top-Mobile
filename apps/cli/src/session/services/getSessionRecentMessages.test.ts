import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchEncryptedTranscriptMessagesPage, resolveSessionTransportContext } = vi.hoisted(() => ({
  fetchEncryptedTranscriptMessagesPage: vi.fn(),
  resolveSessionTransportContext: vi.fn(),
}));

vi.mock('@/session/replay/fetchEncryptedTranscriptMessages', () => ({
  fetchEncryptedTranscriptMessagesPage,
}));

vi.mock('./resolveSessionTransportContext', () => ({
  resolveSessionTransportContext,
}));

describe('extractRecentMessagesFromTranscriptRows', () => {
  beforeEach(() => {
    fetchEncryptedTranscriptMessagesPage.mockReset();
    resolveSessionTransportContext.mockReset();
  });

  it('filters roles, skips memory artifacts, and truncates message text', async () => {
    const { extractRecentMessagesFromTranscriptRows } = await import('./getSessionRecentMessages');
    const rows = [
      {
        seq: 3,
        createdAt: 30,
        content: {
          t: 'plain',
          v: {
            role: 'user',
            content: { type: 'text', text: 'hello world' },
            meta: {},
          },
        },
      },
      {
        seq: 2,
        createdAt: 20,
        content: {
          t: 'plain',
          v: {
            role: 'assistant',
            content: { type: 'text', text: 'skip me' },
            meta: { happier: { kind: 'session_synopsis.v1', payload: {} } },
          },
        },
      },
      {
        seq: 1,
        createdAt: 10,
        content: {
          t: 'plain',
          v: {
            role: 'assistant',
            content: { type: 'text', text: 'assistant text' },
            meta: {},
          },
        },
      },
    ] as const;

    const result = extractRecentMessagesFromTranscriptRows({
      rows,
      ctx: { encryptionKey: new Uint8Array([1]), encryptionVariant: 'legacy' },
      includeUser: true,
      includeAssistant: true,
      maxCharsPerMessage: 5,
    });

    expect(result).toEqual([
      { id: '3', createdAt: 30, role: 'user', text: 'hello' },
      { id: '1', createdAt: 10, role: 'assistant', text: 'assis' },
    ]);
  });

  it('excludes assistant messages when includeAssistant is false', async () => {
    const { extractRecentMessagesFromTranscriptRows } = await import('./getSessionRecentMessages');
    const rows = [
      {
        seq: 1,
        createdAt: 10,
        content: {
          t: 'plain',
          v: {
            role: 'assistant',
            content: { type: 'text', text: 'assistant text' },
            meta: {},
          },
        },
      },
    ] as const;

    const result = extractRecentMessagesFromTranscriptRows({
      rows,
      ctx: { encryptionKey: new Uint8Array([1]), encryptionVariant: 'legacy' },
      includeUser: true,
      includeAssistant: false,
      maxCharsPerMessage: null,
    });

    expect(result).toEqual([]);
  });

  it('includes provider assistant messages when includeAssistant is true', async () => {
    const { extractRecentMessagesFromTranscriptRows } = await import('./getSessionRecentMessages');
    const rows = [
      {
        seq: 1,
        createdAt: 10,
        content: {
          t: 'plain',
          v: {
            role: 'agent',
            content: {
              type: 'acp',
              provider: 'codex',
              data: {
                type: 'message',
                message: 'assistant provider text',
              },
            },
            meta: {},
          },
        },
      },
    ] as const;

    const result = extractRecentMessagesFromTranscriptRows({
      rows,
      ctx: { encryptionKey: new Uint8Array([1]), encryptionVariant: 'legacy' },
      includeUser: true,
      includeAssistant: true,
      maxCharsPerMessage: null,
    });

    expect(result).toEqual([
      { id: '1', createdAt: 10, role: 'agent', text: 'assistant provider text' },
    ]);
  });

  it('scans additional raw pages until the semantic message limit is satisfied', async () => {
    const { getSessionRecentMessages } = await import('./getSessionRecentMessages');
    resolveSessionTransportContext.mockResolvedValue({
      ok: true,
      sessionId: 'sess-1',
      rawSession: { id: 'sess-1' },
      mode: 'plain',
      ctx: { encryptionKey: new Uint8Array([1]), encryptionVariant: 'legacy' },
    });
    fetchEncryptedTranscriptMessagesPage
      .mockResolvedValueOnce({
        messages: [
          {
            seq: 10,
            createdAt: 100,
            content: {
              t: 'plain',
              v: {
                role: 'agent',
                content: {
                  type: 'codex',
                  data: { type: 'token_count', input_tokens: 1, output_tokens: 2 },
                },
              },
            },
          },
        ],
        hasMore: true,
        nextBeforeSeq: 9,
        nextAfterSeq: null,
      })
      .mockResolvedValueOnce({
        messages: [
          {
            seq: 8,
            createdAt: 80,
            content: {
              t: 'plain',
              v: {
                role: 'user',
                content: { type: 'text', text: 'second page user text' },
              },
            },
          },
        ],
        hasMore: false,
        nextBeforeSeq: null,
        nextAfterSeq: null,
      });

    const result = await getSessionRecentMessages({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array([1]) } },
      idOrPrefix: 'sess-1',
      limit: 1,
    });

    expect(result).toEqual({
      ok: true,
      sessionId: 'sess-1',
      messages: [
        {
          id: '8',
          createdAt: 80,
          role: 'user',
          text: 'second page user text',
        },
      ],
      nextCursor: null,
    });
    expect(fetchEncryptedTranscriptMessagesPage).toHaveBeenCalledTimes(2);
    expect(fetchEncryptedTranscriptMessagesPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      beforeSeq: 9,
    }));
  });
});
