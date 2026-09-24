import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchSessionSystemRecord,
  fetchLatestSessionSystemRecord,
  fetchSessionSystemRecordsPage,
  upsertSessionSystemRecord,
} from './sessionSystemRecords';

function createFakeResponse(body: unknown, opts?: { status?: number }) {
  const status = opts?.status ?? 200;
  return {
    status,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('sessionSystemRecords testkit helpers', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('upserts session system records through the v2 session scoped API', async () => {
    const observedCalls: Array<Readonly<{ url: string; init?: RequestInit }>> = [];
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      observedCalls.push({ url: String(url), ...(init ? { init } : {}) });
      return createFakeResponse({
        record: {
          id: 'ssr_1',
          sessionId: 'ses_1',
          namespace: 'memory',
          kind: 'summary_shard.v1',
          localId: 'memory:summary_shard:v1:1-5',
          content: { t: 'encrypted', c: 'ciphertext' },
          createdAt: '2026-05-19T00:00:00.000Z',
          updatedAt: '2026-05-19T00:00:01.000Z',
        },
      });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    const record = await upsertSessionSystemRecord({
      baseUrl: 'http://localhost:1234',
      token: 'token',
      sessionId: 'ses_1',
      namespace: 'memory',
      kind: 'summary_shard.v1',
      localId: 'memory:summary_shard:v1:1-5',
      content: { t: 'encrypted', c: 'ciphertext' },
    });

    expect(record.localId).toBe('memory:summary_shard:v1:1-5');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = observedCalls[0];
    expect(firstCall).toBeDefined();
    const url = firstCall?.url ?? '';
    const init = firstCall?.init ?? {};
    expect(url).toBe('http://localhost:1234/v2/sessions/ses_1/system-records');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    }));
    expect(JSON.parse(String(init.body))).toEqual({
      namespace: 'memory',
      kind: 'summary_shard.v1',
      localId: 'memory:summary_shard:v1:1-5',
      content: { t: 'encrypted', c: 'ciphertext' },
    });
  });

  it('lists session system records with namespace, kind, and cursor query params', async () => {
    const observedCalls: Array<Readonly<{ url: string; init?: RequestInit }>> = [];
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      observedCalls.push({ url: String(url), ...(init ? { init } : {}) });
      return createFakeResponse({
        records: [
          {
            id: 'ssr_1',
            sessionId: 'ses_1',
            namespace: 'memory',
            kind: 'summary_shard.v1',
            localId: 'memory:summary_shard:v1:1-5',
            content: {
              t: 'plain',
              v: {
                v: 1,
                seqFrom: 1,
                seqTo: 5,
                createdAtFromMs: 100,
                createdAtToMs: 500,
                summary: 'hello',
                keywords: [],
                entities: [],
                decisions: [],
              },
            },
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:01.000Z',
          },
        ],
        nextCursor: 'next-page',
        hasNext: true,
      });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    const page = await fetchSessionSystemRecordsPage({
      baseUrl: 'http://localhost:1234',
      token: 'token',
      sessionId: 'ses_1',
      namespace: 'memory',
      kind: 'summary_shard.v1',
      localId: 'memory:summary_shard:v1:1-5',
      cursor: 'cursor-1',
      limit: 25,
    });

    expect(page.records).toHaveLength(1);
    expect(page.nextCursor).toBe('next-page');
    expect(page.hasNext).toBe(true);
    const url = observedCalls[0]?.url ?? '';
    expect(url).toBe(
      'http://localhost:1234/v2/sessions/ses_1/system-records?namespace=memory&kind=summary_shard.v1&localId=memory%3Asummary_shard%3Av1%3A1-5&limit=25&cursor=cursor-1',
    );
  });

  it('fetches the latest session system record by namespace and kind', async () => {
    const observedCalls: Array<Readonly<{ url: string; init?: RequestInit }>> = [];
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      observedCalls.push({ url: String(url), ...(init ? { init } : {}) });
      return createFakeResponse({
        record: {
          id: 'ssr_2',
          sessionId: 'ses_1',
          namespace: 'memory',
          kind: 'synopsis.v1',
          localId: 'memory:synopsis:v1:5',
          content: { t: 'plain', v: { v: 1, seqTo: 5, updatedAtMs: 600, synopsis: 'latest' } },
          createdAt: '2026-05-19T00:00:00.000Z',
          updatedAt: '2026-05-19T00:00:01.000Z',
        },
      });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    const record = await fetchLatestSessionSystemRecord({
      baseUrl: 'http://localhost:1234',
      token: 'token',
      sessionId: 'ses_1',
      namespace: 'memory',
      kind: 'synopsis.v1',
    });

    expect(record?.kind).toBe('synopsis.v1');
    const url = observedCalls[0]?.url ?? '';
    expect(url).toBe('http://localhost:1234/v2/sessions/ses_1/system-records/latest?namespace=memory&kind=synopsis.v1');
  });

  it('rejects session-not-found responses for latest lookups', async () => {
    const fetchSpy = vi.fn(async () => createFakeResponse({ error: 'Session not found' }, { status: 404 }));
    globalThis.fetch = fetchSpy as typeof fetch;

    await expect(fetchLatestSessionSystemRecord({
      baseUrl: 'http://localhost:1234',
      token: 'token',
      sessionId: 'ses_missing',
      namespace: 'memory',
      kind: 'synopsis.v1',
    })).rejects.toThrow(/session system record latest/i);
  });

  it('rejects protocol-invalid plain memory payloads returned by the API', async () => {
    const fetchSpy = vi.fn(async () => createFakeResponse({
      record: {
        id: 'ssr_bad',
        sessionId: 'ses_1',
        namespace: 'memory',
        kind: 'synopsis.v1',
        localId: 'memory:synopsis:v1:5',
        content: { t: 'plain', v: { v: 1, summary: 'wrong payload for synopsis kind' } },
        createdAt: '2026-05-19T00:00:00.000Z',
        updatedAt: '2026-05-19T00:00:01.000Z',
      },
    }));
    globalThis.fetch = fetchSpy as typeof fetch;

    await expect(fetchLatestSessionSystemRecord({
      baseUrl: 'http://localhost:1234',
      token: 'token',
      sessionId: 'ses_1',
      namespace: 'memory',
      kind: 'synopsis.v1',
    })).rejects.toThrow(/session system record/i);
  });

  it('fetches a session system record by namespace and local id', async () => {
    const observedCalls: Array<Readonly<{ url: string; init?: RequestInit }>> = [];
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      observedCalls.push({ url: String(url), ...(init ? { init } : {}) });
      return createFakeResponse({
        record: {
          id: 'ssr_3',
          sessionId: 'ses_1',
          namespace: 'memory',
          kind: 'synopsis.v1',
          localId: 'memory:synopsis:v1:5',
          content: { t: 'plain', v: { v: 1, seqTo: 5, updatedAtMs: 600, synopsis: 'lookup' } },
          createdAt: '2026-05-19T00:00:00.000Z',
          updatedAt: '2026-05-19T00:00:01.000Z',
        },
      });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    const record = await fetchSessionSystemRecord({
      baseUrl: 'http://localhost:1234',
      token: 'token',
      sessionId: 'ses_1',
      namespace: 'memory',
      localId: 'memory:synopsis:v1:5',
    });

    expect(record?.localId).toBe('memory:synopsis:v1:5');
    const url = observedCalls[0]?.url ?? '';
    expect(url).toBe('http://localhost:1234/v2/sessions/ses_1/system-records/record?namespace=memory&localId=memory%3Asynopsis%3Av1%3A5');
  });
});
