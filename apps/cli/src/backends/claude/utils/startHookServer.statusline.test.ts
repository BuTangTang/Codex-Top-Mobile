import { afterEach, describe, expect, it, vi } from 'vitest';

import { startHookServer } from './startHookServer';
import type { ClaudeStatuslinePayload } from '../statusline/statuslinePayload';

async function postStatusline(params: {
  port: number;
  secret?: string;
  body: string;
}): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${params.port}/hook/statusline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(params.secret ? { 'x-happier-hook-secret': params.secret } : {}),
    },
    body: params.body,
  });
  return { status: res.status, text: await res.text() };
}

describe('startHookServer (statusline hook)', () => {
  const servers: Array<{ stop: () => void }> = [];

  afterEach(() => {
    for (const server of servers.splice(0, servers.length)) {
      server.stop();
    }
  });

  it('delivers a parsed statusline payload to the typed callback', async () => {
    const received: ClaudeStatuslinePayload[] = [];
    const server = await startHookServer({
      onSessionHook: vi.fn(),
      permissionHookSecret: 'secret-1',
      onStatuslineUpdate: (payload) => {
        received.push(payload);
      },
    });
    servers.push(server);

    const body = JSON.stringify({
      session_id: 'sess-1',
      transcript_path: '/tmp/t.jsonl',
      model: { id: 'claude-haiku-4-5-20251001', display_name: 'Haiku 4.5' },
      context_window: { context_window_size: 200000, current_usage: null },
      version: '2.1.170',
      exceeds_200k_tokens: false,
      thinking: { enabled: true },
      some_future_field: { nested: true },
    });
    const response = await postStatusline({ port: server.port, secret: 'secret-1', body });

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]!.session_id).toBe('sess-1');
    expect(received[0]!.model?.id).toBe('claude-haiku-4-5-20251001');
    expect(received[0]!.model?.display_name).toBe('Haiku 4.5');
    expect(received[0]!.context_window?.context_window_size).toBe(200000);
    // Unknown additions must pass through untouched (passthrough-style parsing).
    expect((received[0] as Record<string, unknown>).some_future_field).toEqual({ nested: true });
  });

  it('rejects statusline posts without the shared secret', async () => {
    const onStatuslineUpdate = vi.fn();
    const server = await startHookServer({
      onSessionHook: vi.fn(),
      permissionHookSecret: 'secret-2',
      onStatuslineUpdate,
    });
    servers.push(server);

    const missing = await postStatusline({ port: server.port, body: '{}' });
    const wrong = await postStatusline({ port: server.port, secret: 'nope', body: '{}' });

    expect(missing.status).toBe(403);
    expect(wrong.status).toBe(403);
    expect(onStatuslineUpdate).not.toHaveBeenCalled();
  });

  it('tolerates malformed payloads without invoking the callback or failing the request', async () => {
    const onStatuslineUpdate = vi.fn();
    const server = await startHookServer({
      onSessionHook: vi.fn(),
      permissionHookSecret: 'secret-3',
      onStatuslineUpdate,
    });
    servers.push(server);

    const garbage = await postStatusline({ port: server.port, secret: 'secret-3', body: 'not json {' });
    const array = await postStatusline({ port: server.port, secret: 'secret-3', body: '[1,2,3]' });

    expect(garbage.status).toBe(200);
    expect(array.status).toBe(200);
    expect(onStatuslineUpdate).not.toHaveBeenCalled();
  });

  it('does not fail the statusline request when the callback throws', async () => {
    const server = await startHookServer({
      onSessionHook: vi.fn(),
      permissionHookSecret: 'secret-4',
      onStatuslineUpdate: () => {
        throw new Error('consumer exploded');
      },
    });
    servers.push(server);

    const response = await postStatusline({ port: server.port, secret: 'secret-4', body: '{"session_id":"x"}' });

    expect(response.status).toBe(200);
  });
});
