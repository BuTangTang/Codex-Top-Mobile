import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerDebug } = vi.hoisted(() => ({
  loggerDebug: vi.fn(),
}));

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: loggerDebug,
  },
}));

import { fetchTranscriptSemanticPage } from './fetchTranscriptSemanticPage';
import type { FetchTranscriptRawPage } from './fetchTranscriptSemanticPage';

const ctx = { encryptionKey: new Uint8Array([1]), encryptionVariant: 'legacy' as const };

describe('fetchTranscriptSemanticPage', () => {
  beforeEach(() => {
    loggerDebug.mockReset();
  });

  it('counts semantic items while scanning sparse raw pages', async () => {
    const fetchPage = vi.fn<FetchTranscriptRawPage>()
      .mockResolvedValueOnce({
        messages: [
          {
            seq: 10,
            createdAt: 100,
            messageRole: 'agent',
            content: {
              t: 'plain',
              v: {
                role: 'agent',
                content: { type: 'codex', data: { type: 'token_count', input_tokens: 1, output_tokens: 2 } },
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
            messageRole: 'user',
            content: {
              t: 'plain',
              v: { role: 'user', content: { type: 'text', text: 'second page user text' } },
            },
          },
        ],
        hasMore: false,
        nextBeforeSeq: null,
        nextAfterSeq: null,
      });

    const page = await fetchTranscriptSemanticPage({
      token: 'token',
      sessionId: 'sess-1',
      ctx,
      limit: 1,
      rawPageLimit: 1,
      maxRawRowsToScan: 10,
      direction: 'before',
      scope: 'main',
      serverRoles: ['user', 'agent'],
      mode: 'transcript',
      transcriptRoles: ['user', 'assistant'],
      fetchPage,
    });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: '8',
        role: 'user',
        kind: 'user_message',
        text: 'second page user text',
      }),
    ]);
    expect(page.diagnostics).toMatchObject({
      rawRowsScanned: 2,
      pagesFetched: 2,
      scanLimitReached: false,
    });
    expect(fetchPage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      direction: 'before',
      scope: 'main',
      roles: ['user', 'agent'],
    }));
    expect(fetchPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      beforeSeq: 9,
    }));
  });

  it('maps after cursors to forward page fetches', async () => {
    const fetchPage = vi.fn<FetchTranscriptRawPage>().mockResolvedValueOnce({
      messages: [
        {
          seq: 5,
          createdAt: 50,
          messageRole: 'agent',
          content: {
            t: 'plain',
            v: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'newer reply' } } },
          },
        },
      ],
      hasMore: true,
      nextBeforeSeq: null,
      nextAfterSeq: 5,
    });

    const page = await fetchTranscriptSemanticPage({
      token: 'token',
      sessionId: 'sess-1',
      ctx,
      limit: 1,
      rawPageLimit: 10,
      maxRawRowsToScan: 10,
      direction: 'after',
      cursor: '4',
      scope: 'all',
      serverRoles: ['agent'],
      mode: 'transcript',
      transcriptRoles: ['assistant'],
      fetchPage,
    });

    expect(page.nextCursor).toBe('5');
    expect(page.hasMore).toBe(true);
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({
      afterSeq: 4,
      scope: 'all',
      roles: ['agent'],
    }));
  });

  it('resumes from the last consumed row when the semantic limit stops inside a raw page', async () => {
    const fetchPage = vi.fn<FetchTranscriptRawPage>().mockResolvedValueOnce({
      messages: [
        {
          seq: 10,
          createdAt: 100,
          messageRole: 'user',
          content: {
            t: 'plain',
            v: { role: 'user', content: { type: 'text', text: 'first message' } },
          },
        },
        {
          seq: 9,
          createdAt: 90,
          messageRole: 'user',
          content: {
            t: 'plain',
            v: { role: 'user', content: { type: 'text', text: 'second message' } },
          },
        },
      ],
      hasMore: false,
      nextBeforeSeq: null,
      nextAfterSeq: null,
    });

    const page = await fetchTranscriptSemanticPage({
      token: 'token',
      sessionId: 'sess-1',
      ctx,
      limit: 1,
      rawPageLimit: 20,
      maxRawRowsToScan: 20,
      direction: 'before',
      scope: 'main',
      serverRoles: ['user'],
      mode: 'transcript',
      transcriptRoles: ['user'],
      fetchPage,
    });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: '10',
        role: 'user',
        text: 'first message',
      }),
    ]);
    expect(page.nextCursor).toBe('10');
    expect(page.hasMore).toBe(true);
  });

  it('reports scan budget exhaustion', async () => {
    const fetchPage = vi.fn<FetchTranscriptRawPage>()
      .mockResolvedValueOnce({
        messages: [
          {
            seq: 10,
            createdAt: 100,
            content: { t: 'plain', v: { role: 'agent', content: { type: 'codex', data: { type: 'token_count' } } } },
          },
          {
            seq: 9,
            createdAt: 90,
            content: { t: 'plain', v: { role: 'agent', content: { type: 'codex', data: { type: 'token_count' } } } },
          },
        ],
        hasMore: true,
        nextBeforeSeq: 8,
        nextAfterSeq: null,
      });

    const page = await fetchTranscriptSemanticPage({
      token: 'token',
      sessionId: 'sess-1',
      ctx,
      limit: 1,
      rawPageLimit: 2,
      maxRawRowsToScan: 2,
      direction: 'before',
      scope: 'main',
      serverRoles: ['agent'],
      mode: 'transcript',
      transcriptRoles: ['assistant'],
      fetchPage,
    });

    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('8');
    expect(page.diagnostics).toMatchObject({
      rawRowsScanned: 2,
      pagesFetched: 1,
      scanLimitReached: true,
    });
    expect(loggerDebug).toHaveBeenCalledWith('session_transcript_scan_budget_exhausted', {
      direction: 'before',
      limit: 1,
      maxRawRowsToScan: 2,
      mode: 'transcript',
      pagesFetched: 1,
      rawRowsScanned: 2,
      scope: 'main',
      sessionId: 'sess-1',
    });
  });

  it('logs safe raw payload truncation telemetry without transcript content', async () => {
    const fetchPage = vi.fn<FetchTranscriptRawPage>().mockResolvedValueOnce({
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
                data: { type: 'tool-call', name: 'Bash', input: { command: 'secret'.repeat(100) } },
              },
            },
          },
        },
      ],
      hasMore: false,
      nextBeforeSeq: null,
      nextAfterSeq: null,
    });

    const page = await fetchTranscriptSemanticPage({
      token: 'token',
      sessionId: 'sess-1',
      ctx,
      limit: 1,
      rawPageLimit: 1,
      maxRawRowsToScan: 1,
      direction: 'before',
      scope: 'all',
      mode: 'events',
      includeRaw: true,
      maxPayloadChars: 32,
      fetchPage,
    });

    expect(page.diagnostics.payloadTruncations).toBe(1);
    expect(loggerDebug).toHaveBeenCalledWith('session_events_payload_truncated', {
      limit: 1,
      maxPayloadChars: 32,
      maxTotalPayloadBytes: 262144,
      mode: 'events',
      pagesFetched: 1,
      payloadTruncations: 1,
      rawRowsScanned: 1,
      sessionId: 'sess-1',
    });
    const payload = loggerDebug.mock.calls.at(-1)?.[1];
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('applies event kind filters before total raw payload budget truncation', async () => {
    const fetchPage = vi.fn<FetchTranscriptRawPage>().mockResolvedValueOnce({
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
                data: { type: 'tool-call', name: 'Bash', input: { command: 'x'.repeat(200) } },
              },
            },
          },
        },
        {
          seq: 9,
          createdAt: 90,
          content: {
            t: 'plain',
            v: {
              role: 'agent',
              content: { type: 'codex', data: { type: 'token_count' } },
            },
          },
        },
      ],
      hasMore: false,
      nextBeforeSeq: null,
      nextAfterSeq: null,
    });

    const page = await fetchTranscriptSemanticPage({
      token: 'token',
      sessionId: 'sess-1',
      ctx,
      limit: 1,
      rawPageLimit: 2,
      maxRawRowsToScan: 2,
      direction: 'before',
      scope: 'all',
      mode: 'events',
      includeRaw: true,
      eventKinds: ['usage'],
      maxTotalPayloadBytes: 1,
      fetchPage,
    });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: '9',
        kind: 'usage',
      }),
    ]);
  });
});
