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

const credentials = { token: 'token', encryption: { type: 'legacy' as const, secret: new Uint8Array([1]) } };

describe('getSessionEvents', () => {
  beforeEach(() => {
    fetchEncryptedTranscriptMessagesPage.mockReset();
    resolveSessionTransportContext.mockReset();
  });

  it('recovers historical event rows without default stored-role prefiltering', async () => {
    const { getSessionEvents } = await import('./getSessionEvents');
    resolveSessionTransportContext.mockResolvedValue({
      ok: true,
      sessionId: 'sess-1',
      rawSession: { id: 'sess-1' },
      mode: 'plain',
      ctx: { encryptionKey: new Uint8Array([1]), encryptionVariant: 'legacy' },
    });
    fetchEncryptedTranscriptMessagesPage.mockResolvedValueOnce({
      messages: [
        {
          seq: 4,
          createdAt: 40,
          messageRole: 'agent',
          content: {
            t: 'plain',
            v: {
              role: 'agent',
              content: {
                type: 'codex',
                provider: 'codex',
                data: { type: 'tool-call', callId: 'call-1', name: 'Bash', input: { command: 'pwd' } },
              },
            },
          },
        },
      ],
      hasMore: false,
      nextBeforeSeq: null,
      nextAfterSeq: null,
    });

    const result = await getSessionEvents({ credentials, idOrPrefix: 'sess-1' });

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'sess-1',
      items: [
        {
          id: '4',
          storedMessageRole: 'agent',
          semanticRole: 'tool',
          kind: 'tool_call',
          toolName: 'Bash',
          callId: 'call-1',
        },
      ],
    });
    expect(fetchEncryptedTranscriptMessagesPage).toHaveBeenCalledWith(expect.not.objectContaining({
      roles: expect.anything(),
    }));
    if (result.ok) {
      expect(result.items[0]).not.toHaveProperty('raw');
    }
  });

  it('passes explicit stored-role filters to the server', async () => {
    const { getSessionEvents } = await import('./getSessionEvents');
    resolveSessionTransportContext.mockResolvedValue({
      ok: true,
      sessionId: 'sess-1',
      rawSession: { id: 'sess-1' },
      mode: 'plain',
      ctx: { encryptionKey: new Uint8Array([1]), encryptionVariant: 'legacy' },
    });
    fetchEncryptedTranscriptMessagesPage.mockResolvedValueOnce({
      messages: [],
      hasMore: false,
      nextBeforeSeq: null,
      nextAfterSeq: null,
    });

    await getSessionEvents({ credentials, idOrPrefix: 'sess-1', roles: ['event'] });

    expect(fetchEncryptedTranscriptMessagesPage).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['event'],
    }));
  });

  it('bounds raw payloads when explicit raw inclusion is requested', async () => {
    const { getSessionEvents } = await import('./getSessionEvents');
    resolveSessionTransportContext.mockResolvedValue({
      ok: true,
      sessionId: 'sess-1',
      rawSession: { id: 'sess-1' },
      mode: 'plain',
      ctx: { encryptionKey: new Uint8Array([1]), encryptionVariant: 'legacy' },
    });
    fetchEncryptedTranscriptMessagesPage.mockResolvedValueOnce({
      messages: [
        {
          seq: 4,
          createdAt: 40,
          messageRole: 'event',
          content: {
            t: 'plain',
            v: {
              role: 'agent',
              content: {
                type: 'codex',
                data: { type: 'tool-call', callId: 'call-1', name: 'Bash', input: { command: 'x'.repeat(200) } },
              },
            },
          },
        },
      ],
      hasMore: false,
      nextBeforeSeq: null,
      nextAfterSeq: null,
    });

    const result = await getSessionEvents({
      credentials,
      idOrPrefix: 'sess-1',
      includeRaw: true,
      maxPayloadChars: 60,
    });

    expect(result).toMatchObject({
      ok: true,
      diagnostics: { payloadTruncations: 1 },
      items: [
        expect.objectContaining({
          rawTruncated: true,
        }),
      ],
    });
  });

  it('scans additional raw pages until the event kind filter is satisfied', async () => {
    const { getSessionEvents } = await import('./getSessionEvents');
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
            seq: 4,
            createdAt: 40,
            messageRole: 'event',
            content: {
              t: 'plain',
              v: { role: 'agent', content: { type: 'codex', data: { type: 'tool-call', name: 'Bash' } } },
            },
          },
        ],
        hasMore: true,
        nextBeforeSeq: 3,
        nextAfterSeq: null,
      })
      .mockResolvedValueOnce({
        messages: [
          {
            seq: 2,
            createdAt: 20,
            messageRole: 'event',
            content: {
              t: 'plain',
              v: { role: 'agent', content: { type: 'codex', data: { type: 'token_count' } } },
            },
          },
        ],
        hasMore: false,
        nextBeforeSeq: null,
        nextAfterSeq: null,
      });

    const result = await getSessionEvents({
      credentials,
      idOrPrefix: 'sess-1',
      limit: 1,
      kinds: ['usage'],
    });

    expect(result).toMatchObject({
      ok: true,
      items: [
        {
          id: '2',
          kind: 'usage',
        },
      ],
      diagnostics: {
        rawRowsScanned: 2,
        pagesFetched: 2,
      },
    });
    expect(fetchEncryptedTranscriptMessagesPage).toHaveBeenCalledTimes(2);
  });
});
