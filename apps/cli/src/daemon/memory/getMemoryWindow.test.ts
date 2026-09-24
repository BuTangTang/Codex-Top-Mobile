import { describe, expect, it } from 'vitest';

import type { Credentials } from '@/persistence';
import { encryptSessionPayload, type SessionEncryptionContext } from '@/session/transport/encryption/sessionEncryptionContext';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';

describe('getMemoryWindow', () => {
  it('decrypts a bounded transcript range and returns a redacted snippet window', async () => {
    const { getMemoryWindow } = await import('./getMemoryWindow');

    const key = new Uint8Array(32).fill(7);
    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: key } };
    const ctx: SessionEncryptionContext = { encryptionKey: key, encryptionVariant: 'legacy' };

    const ciphertext1 = encryptSessionPayload({
      ctx,
      payload: { role: 'user', content: { type: 'text', text: 'hello openclaw' } },
    });
    const ciphertext2 = encryptSessionPayload({
      ctx,
      payload: { role: 'agent', content: { type: 'text', text: 'we discussed memory search' } },
    });

    const window = await getMemoryWindow({
      credentials,
      sessionId: 'sess-1',
      seqFrom: 1,
      seqTo: 2,
      paddingMessages: 0,
      deps: {
        fetchSessionById: async () => createSessionRecordFixture({ id: 'sess-1', active: true, activeAt: 1, metadata: 'b64' }),
        fetchEncryptedTranscriptMessagesPage: async () => ({
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
          messages: [
            { seq: 1, createdAt: 1000, content: { t: 'encrypted' as const, c: ciphertext1 } },
            { seq: 2, createdAt: 2000, content: { t: 'encrypted' as const, c: ciphertext2 } },
          ],
        }),
      },
    });

    expect(window.v).toBe(1);
    expect(window.snippets.length).toBe(1);
    expect(window.snippets[0]!.text).toContain('hello openclaw');
    expect(window.snippets[0]!.text).toContain('memory search');
    expect(window.citations[0]!.sessionId).toBe('sess-1');
  });

  it('supports plaintext transcript windows (no decrypt)', async () => {
    const { getMemoryWindow } = await import('./getMemoryWindow');

    const key = new Uint8Array(32).fill(7);
    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: key } };

    const window = await getMemoryWindow({
      credentials,
      sessionId: 'sess-plain',
      seqFrom: 1,
      seqTo: 2,
      paddingMessages: 0,
      deps: {
        fetchSessionById: async () => createSessionRecordFixture({ id: 'sess-plain', active: true, activeAt: 1, metadata: '{}' }),
        fetchEncryptedTranscriptMessagesPage: async () => ({
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
          messages: [
            {
              seq: 1,
              createdAt: 1000,
              content: { t: 'plain' as const, v: { role: 'user', content: { type: 'text', text: 'hello' } } },
            },
            {
              seq: 2,
              createdAt: 2000,
              content: { t: 'plain' as const, v: { role: 'agent', content: { type: 'text', text: 'world' } } },
            },
          ],
        }),
      },
    });

    expect(window.v).toBe(1);
    expect(window.snippets.length).toBe(1);
    expect(window.snippets[0]!.text).toContain('User: hello');
    expect(window.snippets[0]!.text).toContain('Assistant: world');
  });

  it('uses semantic transcript extraction for provider-shaped assistant rows', async () => {
    const { getMemoryWindow } = await import('./getMemoryWindow');

    const key = new Uint8Array(32).fill(7);
    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: key } };

    const window = await getMemoryWindow({
      credentials,
      sessionId: 'sess-provider',
      seqFrom: 1,
      seqTo: 2,
      paddingMessages: 0,
      deps: {
        fetchSessionById: async () => createSessionRecordFixture({ id: 'sess-provider', active: true, activeAt: 1, metadata: '{}' }),
        fetchEncryptedTranscriptMessagesPage: async () => ({
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
          messages: [
            {
              seq: 1,
              createdAt: 1000,
              messageRole: 'agent',
              content: { t: 'plain' as const, v: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'codex semantic window text' } } } },
            },
            {
              seq: 2,
              createdAt: 2000,
              messageRole: 'agent',
              content: { t: 'plain' as const, v: { role: 'agent', content: { type: 'output', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'claude semantic window text' }] } } } } },
            },
          ],
        }),
      },
    });

    expect(window.snippets).toHaveLength(1);
    expect(window.snippets[0]!.text).toContain('Assistant: codex semantic window text');
    expect(window.snippets[0]!.text).toContain('Assistant: claude semantic window text');
  });

  it('applies the configured content policy when extracting semantic window rows', async () => {
    const { getMemoryWindow } = await import('./getMemoryWindow');

    const key = new Uint8Array(32).fill(7);
    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: key } };

    const params = {
      credentials,
      sessionId: 'sess-reasoning',
      seqFrom: 1,
      seqTo: 1,
      paddingMessages: 0,
      contentPolicy: {
        includeUserMessages: true,
        includeAssistantMessages: true,
        includeReasoning: true,
        includeToolSummaries: false,
        includeToolOutputs: false,
      },
      deps: {
        fetchSessionById: async () => createSessionRecordFixture({ id: 'sess-reasoning', active: true, activeAt: 1, metadata: '{}' }),
        fetchEncryptedTranscriptMessagesPage: async () => ({
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
          messages: [
            {
              seq: 1,
              createdAt: 1000,
              messageRole: 'agent',
              content: {
                t: 'plain' as const,
                v: {
                  role: 'agent',
                  content: { type: 'codex', data: { type: 'reasoning', message: 'reasoning window sentinel' } },
                },
              },
            },
          ],
        }),
      },
    };

    const window = await getMemoryWindow(params);

    expect(window.snippets).toHaveLength(1);
    expect(window.snippets[0]!.text).toContain('Assistant: reasoning window sentinel');
  });

  it('excludes stored event rows from semantic transcript windows', async () => {
    const { getMemoryWindow } = await import('./getMemoryWindow');

    const key = new Uint8Array(32).fill(7);
    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: key } };

    const window = await getMemoryWindow({
      credentials,
      sessionId: 'sess-events',
      seqFrom: 1,
      seqTo: 2,
      paddingMessages: 0,
      deps: {
        fetchSessionById: async () => createSessionRecordFixture({ id: 'sess-events', active: true, activeAt: 1, metadata: '{}' }),
        fetchEncryptedTranscriptMessagesPage: async () => ({
          hasMore: false,
          nextBeforeSeq: null,
          nextAfterSeq: null,
          messages: [
            {
              seq: 1,
              createdAt: 1000,
              messageRole: 'event',
              content: { t: 'plain' as const, v: { role: 'agent', content: { type: 'text', text: 'tool event noise' } } },
            },
            {
              seq: 2,
              createdAt: 2000,
              messageRole: 'user',
              content: { t: 'plain' as const, v: { role: 'user', content: { type: 'text', text: 'semantic user row' } } },
            },
          ],
        }),
      },
    });

    const text = window.snippets.map((snippet) => snippet.text).join('\n');
    expect(text).toContain('semantic user row');
    expect(text).not.toContain('tool event noise');
  });
});
