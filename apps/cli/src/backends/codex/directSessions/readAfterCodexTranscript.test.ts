import { access, mkdir, mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createCodexAppServerProcessEnv,
  writeFakeCodexAppServerScript,
  writeFakeCodexAppServerThreadListScript,
} from '@/backends/codex/appServer/testkit/fakeCodexAppServer';
import { decodeCodexDirectForwardCursor } from './codexDirectForwardCursor';
import { readAfterCodexTranscript } from './readAfterCodexTranscript';
import { isCodexCompactedLinePrefix } from './codexDirectTranscriptProjection';

function sessionMetaLine(payload: Record<string, unknown>): string {
  return `${JSON.stringify({ type: 'session_meta', payload })}\n`;
}

function responseItemLine(params: { timestamp: string; payload: Record<string, unknown> }): string {
  return `${JSON.stringify({ type: 'response_item', timestamp: params.timestamp, payload: params.payload })}\n`;
}

describe('readAfterCodexTranscript', () => {
  it('only ignores native compacted envelope prefixes, never nested or quoted message content', () => {
    expect(isCodexCompactedLinePrefix(Buffer.from('{"type":"compacted","payload":'))).toBe(true);
    expect(isCodexCompactedLinePrefix(Buffer.from('{"timestamp":"2026-01-02T00:00:00Z","type":"compacted","payload":'))).toBe(true);
    expect(isCodexCompactedLinePrefix(Buffer.from('{"timestamp":"2026-01-02T00:00:00Z","ordinal":123,"type":"compacted","payload":'))).toBe(true);
    for (const value of [
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: '{"type":"compacted",' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'text', text: 'x'.repeat(9 * 1024 * 1024) }] } },
      { payload: { type: 'compacted' }, type: 'response_item' },
      { type: 'response_item', payload: { type: 'function_call_output', output: '{"agent_id":"child"}' } },
    ]) expect(isCodexCompactedLinePrefix(Buffer.from(JSON.stringify(value)))).toBe(false);
  });

  it('continues text follow after a compacted row larger than the parser cap without losing adjacent text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-large-compacted-'));
    const codexHome = join(root, 'codex-home');
    await mkdir(join(codexHome, 'sessions'), { recursive: true });
    const sessionId = 'large-compacted-text';
    const filePath = join(codexHome, 'sessions', `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);
    await writeFile(filePath, sessionMetaLine({ id: sessionId }));
    const params = { source: { kind: 'codexHome', home: 'user' } as const, env: { CODEX_HOME: codexHome },
      activeServerDir: root, remoteSessionId: sessionId, maxBytes: 64 * 1024, maxItems: 2,
      projection: 'conversation_text' as const };
    const initial = await readAfterCodexTranscript({ ...params, cursor: 'tail' });
    const compacted = `${JSON.stringify({ timestamp: '2026-01-02T00:00:01.000Z', ordinal: 123, type: 'compacted',
      payload: { message: 'synthetic', replacement_history: ['x'.repeat(9 * 1024 * 1024)] } })}\n`;
    const text = (role: string, value: string) => responseItemLine({ timestamp: '2026-01-02T00:00:02.000Z',
      payload: { type: 'message', role, content: [{ type: 'text', text: value }] } });
    await appendFile(filePath, compacted + text('user', 'user after compacted') + text('assistant', 'assistant after compacted'));
    let cursor = initial.nextCursor!;
    const items = [];
    for (let page = 0; page < 4; page += 1) {
      const next = await readAfterCodexTranscript({ ...params, cursor });
      items.push(...next.items);
      if (!next.truncated) break;
      expect(next.truncationReason).toBe('page_limit');
      expect(next.nextCursor).not.toBe(cursor);
      cursor = next.nextCursor!;
    }
    expect(items).toHaveLength(2);
    expect(items.map(item => item.raw.role)).toEqual(['user', 'agent']);
    expect(JSON.stringify(items)).toContain('assistant after compacted');
  });

  it('retains an accepted cursor when neither a rollout nor preview exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-history-unavailable-'));
    const codexHome = join(root, 'codex-home');
    await mkdir(codexHome);
    const fakeAppServer = await writeFakeCodexAppServerThreadListScript({ dir: root, initializeName: 'fake', nonArchivedThreads: [] });
    await expect(readAfterCodexTranscript({ source: { kind: 'codexHome', home: 'user' },
      activeServerDir: root, env: createCodexAppServerProcessEnv(fakeAppServer, { CODEX_HOME: codexHome }),
      remoteSessionId: 'missing-history', cursor: 'accepted-cursor', maxBytes: 4096, maxItems: 10,
    })).resolves.toMatchObject({ items: [], nextCursor: 'accepted-cursor', historyAvailability: 'unavailable' });
  });

  it('returns appended messages when following from a tail cursor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '11111111-1111-1111-1111-111111111111';
    const filePath = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);

    await writeFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/one' })
        + responseItemLine({
          timestamp: '2026-01-02T00:00:01.000Z',
          payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        }),
      'utf8',
    );

    const init = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: 'tail',
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(init.items).toHaveLength(0);
    expect(init.truncated).toBe(false);
    expect(init.nextCursor).toBeTruthy();
    expect(decodeCodexDirectForwardCursor(init.nextCursor!)?.kind).toBe('codexForwardStreamVector');

    await appendFile(
      filePath,
      responseItemLine({
        timestamp: '2026-01-02T00:00:02.000Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'new' }] },
      }),
      'utf8',
    );

    const next = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: init.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(next.items.map((item) => (item.raw as any)?.content?.data?.message ?? (item.raw as any)?.content?.text)).toContain(
      'new',
    );
    expect(next.truncated).toBe(false);
    expect(next.nextCursor).toBeTruthy();
    expect(next).toMatchObject({ historyAvailability: 'available' });
  });

  it('keeps the tail cursor at end-of-file when no new lines were appended', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-stable-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '22222222-2222-2222-2222-222222222222';
    const filePath = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);

    await writeFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/two' })
        + responseItemLine({
          timestamp: '2026-01-02T00:00:01.000Z',
          payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        }),
      'utf8',
    );

    const init = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: 'tail',
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(init.items).toHaveLength(0);
    expect(init.nextCursor).toBeTruthy();

    const idle = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: init.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(idle.items).toHaveLength(0);
    expect(idle.truncated).toBe(false);
    expect(idle.nextCursor).toBe(init.nextCursor);
  });

  it('advances the follow cursor across non-renderable rollout lines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-non-renderable-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = 'non-renderable-progress-session';
    const filePath = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);

    await writeFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/non-renderable' }),
      'utf8',
    );

    const init = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: 'tail',
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(init.items).toHaveLength(0);
    expect(init.nextCursor).toBeTruthy();

    await appendFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:01.000Z', cwd: '/repo/non-renderable' }),
      'utf8',
    );

    const firstPoll = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: init.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(firstPoll.items).toHaveLength(0);
    expect(firstPoll.truncated).toBe(false);
    expect(firstPoll.nextCursor).toBeTruthy();
    expect(firstPoll.nextCursor).not.toBe(init.nextCursor);

    const secondPoll = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: firstPoll.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(secondPoll.items).toHaveLength(0);
    expect(secondPoll.truncated).toBe(false);
    expect(secondPoll.nextCursor).toBe(firstPoll.nextCursor);
  });

  it('reports a raw JSONL page bound when non-renderable rows precede a visible item', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-raw-page-limit-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = 'raw-page-limit-session';
    const filePath = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);
    const params = {
      source: { kind: 'codexHome' as const, home: 'user' as const },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      maxBytes: 1024 * 1024,
      maxItems: 1,
    };
    await writeFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/raw-page-limit' }),
      'utf8',
    );
    const tail = await readAfterCodexTranscript({ ...params, cursor: 'tail' });

    await appendFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:01.000Z', cwd: '/repo/raw-page-limit' })
        + sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:02.000Z', cwd: '/repo/raw-page-limit' })
        + sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:03.000Z', cwd: '/repo/raw-page-limit' })
        + responseItemLine({
          timestamp: '2026-01-02T00:00:04.000Z',
          payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'visible after bounded metadata' }] },
        }),
      'utf8',
    );

    const bounded = await readAfterCodexTranscript({ ...params, cursor: tail.nextCursor! });
    expect(bounded.items).toEqual([]);
    expect(bounded).toMatchObject({ truncated: true, truncationReason: 'page_limit' });
    expect(bounded.nextCursor).toBeTruthy();

    const resumed = await readAfterCodexTranscript({ ...params, cursor: bounded.nextCursor! });
    expect(resumed.items).toHaveLength(1);
    expect(JSON.stringify(resumed.items[0] ?? null)).toContain('visible after bounded metadata');
    expect(resumed.truncated).toBe(false);
  });

  it('continues from the last delivered unread line when maxItems truncates a readAfter batch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-batch-progress-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = 'batch-progress-session';
    const filePath = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);

    await writeFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/batch-progress' }),
      'utf8',
    );

    const init = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: 'tail',
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(init.items).toHaveLength(0);
    expect(init.nextCursor).toBeTruthy();

    await appendFile(
      filePath,
      responseItemLine({
        timestamp: '2026-01-02T00:00:01.000Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'first unread item' }] },
      })
      + responseItemLine({
        timestamp: '2026-01-02T00:00:02.000Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'second unread item' }] },
      }),
      'utf8',
    );

    const firstBatch = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: init.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 1,
    });

    expect(firstBatch.items).toHaveLength(1);
    expect(JSON.stringify(firstBatch.items[0] ?? null)).toContain('first unread item');
    expect(firstBatch.truncated).toBe(true);
    expect(firstBatch).toMatchObject({ truncationReason: 'page_limit' });
    expect(firstBatch.nextCursor).toBeTruthy();

    const secondBatch = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: firstBatch.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 1,
    });

    expect(secondBatch.truncated).toBe(false);
    expect(secondBatch.items).toHaveLength(1);
    expect(JSON.stringify(secondBatch.items[0] ?? null)).toContain('second unread item');
    expect(secondBatch.nextCursor).toBeTruthy();
  });

  it('continues within a single multi-item rollout line when maxItems truncates a readAfter batch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-subindex-progress-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = 'subindex-progress-session';
    const childThreadId = '56565656-5656-5656-5656-565656565656';
    const filePath = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);

    await writeFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/subindex-progress' }),
      'utf8',
    );

    const init = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: 'tail',
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(init.items).toHaveLength(0);
    expect(init.nextCursor).toBeTruthy();

    await appendFile(
      filePath,
      `${JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-01-02T00:00:01.000Z',
        payload: {
          type: 'collab_waiting_end',
          sender_thread_id: sessionId,
          agent_statuses: [{
            thread_id: childThreadId,
            agent_nickname: 'Lovelace',
            agent_role: 'explorer',
            status: { completed: 'done' },
          }],
        },
      })}\n`,
      'utf8',
    );

    const firstBatch = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: init.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 1,
    });

    expect(firstBatch.items).toHaveLength(1);
    expect(firstBatch.items[0]?.raw).toEqual(
      expect.objectContaining({
        role: 'agent',
        content: expect.objectContaining({
          data: expect.objectContaining({
            type: 'tool-call',
            callId: childThreadId,
            name: 'SubAgent',
          }),
        }),
      }),
    );
    expect(firstBatch.truncated).toBe(true);
    expect(firstBatch.nextCursor).toBeTruthy();

    const secondBatch = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: firstBatch.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 1,
    });

    expect(secondBatch.truncated).toBe(false);
    expect(secondBatch.items).toHaveLength(1);
    expect(secondBatch.items[0]?.raw).toEqual(
      expect.objectContaining({
        role: 'agent',
        content: expect.objectContaining({
          data: expect.objectContaining({
            type: 'tool-call-result',
            callId: childThreadId,
          }),
        }),
      }),
    );
    expect(secondBatch.nextCursor).toBeTruthy();
  });

  it('keeps polling app-server-linked sessions when rollout files are missing, then forces a refresh when one appears', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-app-server-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(codexHome, { recursive: true });

    const sessionId = 'remote_app_server';
    const fakeAppServer = await writeFakeCodexAppServerThreadListScript({
      dir: root,
      initializeName: 'fake',
      nonArchivedThreads: [{
        id: sessionId,
        name: 'App server tail preview',
        updatedAt: 1736000200,
        cwd: '/repo/from-app-server',
      }],
    });

    const env = createCodexAppServerProcessEnv(fakeAppServer, { CODEX_HOME: codexHome });

    const init = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: 'tail',
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(init.items).toHaveLength(0);
    expect(init.truncated).toBe(false);
    expect(init.nextCursor).toBeTruthy();

    const idle = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: init.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(idle.items).toHaveLength(0);
    expect(idle.truncated).toBe(false);
    expect(idle.nextCursor).toBe(init.nextCursor);

    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`),
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/from-rollout' })
        + responseItemLine({
          timestamp: '2026-01-02T00:00:01.000Z',
          payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'hello from rollout' }] },
        }),
      'utf8',
    );

    const afterRolloutAppears = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: init.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(afterRolloutAppears.items).toHaveLength(0);
    expect(afterRolloutAppears.truncated).toBe(true);
    expect(afterRolloutAppears.nextCursor).toBeTruthy();
    expect(init).toMatchObject({ historyAvailability: 'preview_only' });
    expect(idle).toMatchObject({ historyAvailability: 'preview_only' });
    expect(afterRolloutAppears).toMatchObject({ historyAvailability: 'available' });
  });

  it('does not start the Codex app-server metadata fallback when tailing an existing rollout file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-no-app-server-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = 'tail-existing-rollout-session';
    const markerPath = join(root, 'app-server-started');
    const fakeAppServer = await writeFakeCodexAppServerScript({
      dir: root,
      setupLines: [
        'import("node:fs/promises").then(({ writeFile }) => writeFile(process.env.APP_SERVER_MARKER, "started"));',
      ],
      bodyLines: ['for await (const _line of rl) {}'],
    });

    const filePath = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);
    await writeFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/no-app-server' }),
      'utf8',
    );

    const init = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: createCodexAppServerProcessEnv(fakeAppServer, {
        CODEX_HOME: codexHome,
        APP_SERVER_MARKER: markerPath,
      }),
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: 'tail',
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(init.items).toHaveLength(0);
    expect(init.nextCursor).toBeTruthy();
    await expect(access(markerPath)).rejects.toThrow();
  });

  it('returns appended synthetic SubAgent root rows when collaboration events are written after tail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-subagent-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '55555555-5555-5555-5555-555555555555';
    const childThreadId = '66666666-6666-6666-6666-666666666666';
    const filePath = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);

    await writeFile(
      filePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/subagent-tail' }),
      'utf8',
    );

    const init = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: 'tail',
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(init.items).toHaveLength(0);
    expect(init.nextCursor).toBeTruthy();

    await appendFile(
      filePath,
      responseItemLine({
        timestamp: '2026-01-02T00:00:00.250Z',
        payload: {
          type: 'function_call',
          name: 'spawn_agent',
          arguments: JSON.stringify({ role: 'explorer', prompt: 'inspect the repo' }),
          call_id: 'call_spawn_1',
        },
      })
      + responseItemLine({
        timestamp: '2026-01-02T00:00:00.500Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call_spawn_1',
          output: JSON.stringify({ agent_id: childThreadId, nickname: 'Lovelace' }),
        },
      })
      + `${JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-01-02T00:00:01.000Z',
        payload: {
          type: 'collab_agent_spawn_end',
          sender_thread_id: sessionId,
          new_thread_id: childThreadId,
          new_agent_nickname: 'Lovelace',
          new_agent_role: 'explorer',
          prompt: 'inspect the repo',
        },
      })}\n`
      + `${JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-01-02T00:00:02.000Z',
        payload: {
          type: 'collab_waiting_end',
          sender_thread_id: sessionId,
          agent_statuses: [{
            thread_id: childThreadId,
            agent_nickname: 'Lovelace',
            agent_role: 'explorer',
            status: { completed: 'done' },
          }],
        },
      })}\n`
      + responseItemLine({
        timestamp: '2026-01-02T00:00:02.500Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `<subagent_notification>\n{"agent_id":"${childThreadId}","status":{"completed":"done"}}\n</subagent_notification>`,
          }],
        },
      }),
      'utf8',
    );

    const next = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: init.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(next.items).toHaveLength(2);
    expect(next.items[0]?.raw).toEqual(
      expect.objectContaining({
        role: 'agent',
        content: expect.objectContaining({
          data: expect.objectContaining({
            type: 'tool-call',
            callId: childThreadId,
            name: 'SubAgent',
          }),
        }),
      }),
    );
    expect(next.items[1]?.raw).toEqual(
      expect.objectContaining({
        role: 'agent',
        content: expect.objectContaining({
          data: expect.objectContaining({
            type: 'tool-call-result',
            callId: childThreadId,
          }),
        }),
      }),
    );
  });

  it('returns appended child rollout sidechain messages when a spawned subagent writes to its rollout file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-tail-child-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '99999999-9999-9999-9999-999999999999';
    const childThreadId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const parentFilePath = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);
    const childFilePath = join(sessionsDir, `rollout-2026-01-02T00-00-01-${childThreadId}.jsonl`);

    await writeFile(
      parentFilePath,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/subagent-tail' }),
      'utf8',
    );

    const init = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: 'tail',
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(init.items).toHaveLength(0);
    expect(init.nextCursor).toBeTruthy();

    await appendFile(
      parentFilePath,
      `${JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-01-02T00:00:01.000Z',
        payload: {
          type: 'collab_agent_spawn_end',
          sender_thread_id: sessionId,
          new_thread_id: childThreadId,
          new_agent_nickname: 'Lovelace',
          new_agent_role: 'explorer',
          prompt: 'inspect the repo',
        },
      })}\n`,
      'utf8',
    );
    await writeFile(
      childFilePath,
      responseItemLine({
        timestamp: '2026-01-02T00:00:02.000Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'child summary' }] },
      }),
      'utf8',
    );

    const next = await readAfterCodexTranscript({
      source: { kind: 'codexHome', home: 'user' },
      env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers', 'cloud'),
      remoteSessionId: sessionId,
      cursor: init.nextCursor!,
      maxBytes: 1024 * 1024,
      maxItems: 100,
    });

    expect(next.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          raw: expect.objectContaining({
            role: 'agent',
            content: expect.objectContaining({
              data: expect.objectContaining({
                type: 'message',
                message: 'child summary',
                sidechainId: childThreadId,
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it('forwards an unresolved async hint from the same lifecycle read and omits it after completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-async-hint-'));
    const codexHome = join(root, 'codex-home');
    await mkdir(join(codexHome, 'sessions'), { recursive: true });
    const sessionId = '44444444-4444-4444-4444-444444444444';
    const filePath = join(codexHome, 'sessions', `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);
    const timestamp = '2026-01-02T00:00:01.000Z';
    const line = (value: unknown) => `${JSON.stringify(value)}\n`;
    await writeFile(filePath, line({ type: 'session_meta', payload: { id: sessionId } })
      + line({ type: 'event_msg', timestamp, payload: { type: 'task_started', turn_id: 'turn' } })
      + line({ type: 'response_item', timestamp, payload: { type: 'function_call', name: 'request_user_input_async', call_id: 'call-A',
        arguments: JSON.stringify({ questions: [{ title: '选择', options: ['甲'] }] }) } }));
    const params = { source: { kind: 'codexHome', home: 'user' } as const, env: { CODEX_HOME: codexHome } as NodeJS.ProcessEnv,
      activeServerDir: join(root, 'servers'), remoteSessionId: sessionId, cursor: 'tail', maxBytes: 1024 * 1024, maxItems: 20, includeLifecycleObservation: true };
    const pending = await readAfterCodexTranscript(params);
    expect(pending.pendingAsync).toBe(true);
    expect(pending.lifecycleObservation).toMatchObject({ state: 'needs_input', source: 'rollout', requests: [{ requestId: 'call-A' }] });
    await appendFile(filePath, line({ type: 'event_msg', timestamp, payload: { type: 'task_complete', turn_id: 'turn' } }));
    // 异步题在终态仍未答时提示保留；普通完成没有异步题时不带这个提示。
    const stillPending = await readAfterCodexTranscript({ ...params, cursor: pending.nextCursor! });
    expect(stillPending.pendingAsync).toBe(true);
    const rootDone = await mkdtemp(join(tmpdir(), 'happier-codex-async-hint-done-'));
    const doneHome = join(rootDone, 'codex-home');
    await mkdir(join(doneHome, 'sessions'), { recursive: true });
    const donePath = join(doneHome, 'sessions', `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);
    await writeFile(donePath, line({ type: 'session_meta', payload: { id: sessionId } })
      + line({ type: 'event_msg', timestamp, payload: { type: 'task_started', turn_id: 'turn' } })
      + line({ type: 'event_msg', timestamp, payload: { type: 'task_complete', turn_id: 'turn' } }));
    const done = await readAfterCodexTranscript({ ...params, env: { CODEX_HOME: doneHome } as NodeJS.ProcessEnv, activeServerDir: join(rootDone, 'servers') });
    expect(done.pendingAsync).toBeUndefined();
    expect(done.lifecycleObservation).toMatchObject({ state: 'completed' });
  });
});
