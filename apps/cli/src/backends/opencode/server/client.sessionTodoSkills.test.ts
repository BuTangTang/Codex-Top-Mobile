import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageBuffer } from '@/ui/ink/messageBuffer';

import { createOpenCodeServerRuntimeClient } from './client';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createOpenCodeServerRuntimeClient todo and skills endpoints', () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.HAPPIER_OPENCODE_SERVER_URL;

  beforeEach(() => {
    process.env.HAPPIER_OPENCODE_SERVER_URL = 'http://example.test';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (typeof originalUrl === 'string') {
      process.env.HAPPIER_OPENCODE_SERVER_URL = originalUrl;
    } else {
      delete process.env.HAPPIER_OPENCODE_SERVER_URL;
    }
  });

  it('fetches GET /session/:sessionId/todo', async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String((input as any)?.url ?? '');
      urls.push(url);
      if (url.includes('/global/health')) return jsonResponse({ healthy: true, version: '1.2.15' });
      if (url.includes('/session/ses_1/todo')) {
        return jsonResponse([{ content: 'Ship todos', status: 'in_progress', priority: 'high' }]);
      }
      return jsonResponse({});
    }) as any;

    const client = await createOpenCodeServerRuntimeClient({
      directory: '/repo',
      messageBuffer: new MessageBuffer(),
    });

    expect(typeof (client as any).sessionTodo).toBe('function');
    await expect((client as any).sessionTodo({ sessionId: 'ses_1' })).resolves.toEqual([
      { content: 'Ship todos', status: 'in_progress', priority: 'high' },
    ]);
    expect(urls.some((url) => url.includes('/session/ses_1/todo'))).toBe(true);
  });

  it('fetches GET /skill', async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String((input as any)?.url ?? '');
      if (url.includes('/global/health')) return jsonResponse({ healthy: true, version: '1.2.15' });
      if (url.endsWith('/skill?directory=%2Frepo') || url.includes('/skill?')) {
        return jsonResponse([{ name: 'reviewer', description: 'Review code', location: '/skills/reviewer/SKILL.md', content: 'private' }]);
      }
      return jsonResponse({});
    }) as any;

    const client = await createOpenCodeServerRuntimeClient({
      directory: '/repo',
      messageBuffer: new MessageBuffer(),
    });

    expect(typeof (client as any).appSkills).toBe('function');
    await expect((client as any).appSkills()).resolves.toEqual([
      { name: 'reviewer', description: 'Review code', location: '/skills/reviewer/SKILL.md', content: 'private' },
    ]);
  });
});
