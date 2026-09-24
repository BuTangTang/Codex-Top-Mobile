import { mkdir, mkdtemp, readFile, symlink, writeFile, utimes, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCodexAgentRuntimeDescriptorV1 } from '@happier-dev/protocol';
import { waitForCondition } from '@/testkit/async/waitFor';
import {
  createCodexAppServerProcessEnv,
  writeFakeCodexAppServerScript,
  writeFakeCodexAppServerThreadListScript,
} from '@/backends/codex/appServer/testkit/fakeCodexAppServer';

import { listCodexSessionCandidates } from './listCodexSessionCandidates';

function sessionMetaLine(payload: Record<string, unknown>): string {
  return `${JSON.stringify({ type: 'session_meta', payload })}\n`;
}

function responseItemLine(payload: Record<string, unknown>): string {
  return `${JSON.stringify({ type: 'response_item', payload })}\n`;
}

function createDirectSessionsEnv(codexHome: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return createCodexAppServerProcessEnv(
    overrides.HAPPIER_CODEX_APP_SERVER_BIN ?? join(codexHome, 'missing-codex-app-server-binary'),
    {
      CODEX_HOME: codexHome,
      ...overrides,
    },
  );
}

describe('listCodexSessionCandidates', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unmock('node:fs/promises');
  });

  it('returns structured lifecycle facts for unlinked candidates and replaces stale or incomplete evidence with unknown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-list-lifecycle-'));
    const home = join(root, 'codex');
    const now = Date.now();
    const event = (payload: Record<string, unknown>, at = now - 1000) => JSON.stringify({ type: 'event_msg', timestamp: new Date(at).toISOString(), payload }) + '\n';
    const file = join(home, 'sessions', 'rollout-2026-01-01T00-00-00-root.jsonl');
    const start = event({ type: 'task_started', turn_id: 'turn-1' });
    const params = { source: { kind: 'codexHome' as const, home: 'user' as const }, activeServerDir: join(root, 'server'), env: createDirectSessionsEnv(home), limit: 50, searchMode: 'fast' as const };
    try {
      await mkdir(join(home, 'sessions'), { recursive: true });
      for (const [body, state] of [
        [start, 'running'],
        [start + event({ type: 'request_user_input', call_id: 'question' }), 'needs_input'],
        [start + event({ type: 'task_complete', turn_id: 'turn-1' }), 'completed'],
        [event({ type: 'task_started', turn_id: 'turn-1' }, now - 901_000), 'unknown'],
        [start + event({ type: 'task_complete', turn_id: 'turn-1' }) + '{"type":', 'unknown'],
      ]) {
        await writeFile(file, sessionMetaLine({ id: 'root', source: 'cli' }) + body);
        const result = await listCodexSessionCandidates(params);
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0]?.details?.codexLifecycle).toMatchObject({ v: 1, state, eventAtMs: state === 'unknown' ? null : now - 1000, checkedAtMs: expect.any(Number) });
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('prefers a reliable local index over app-server preview in listing, title search and fast exact search', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-index-candidate-'));
    const home = join(root, 'codex');
    const id = '01a0c7cf-6bea-7d50-927b-882a31974396';
    await mkdir(join(home, 'sessions'), { recursive: true });
    await writeFile(join(home, 'sessions', `rollout-2026-01-01T00-00-00-${id}.jsonl`), sessionMetaLine({ id, cwd: '/synthetic' }) + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Long initial prompt' }] }));
    const appOnlyId = '01a0c7cf-6bea-7d50-927b-882a31974395';
    await writeFile(join(home, 'session_index.jsonl'), [id, appOnlyId].map((threadId) => JSON.stringify({ id: threadId, thread_name: '合成短标题', updated_at: '2026-01-02T00:00:00Z' })).join('\n') + '\n');
    const bin = await writeFakeCodexAppServerThreadListScript({ dir: root, nonArchivedThreads: [{ id, preview: 'App server preview paragraph', updatedAt: 500 }, { id: appOnlyId, name: 'App server name', updatedAt: 600 }] });
    const params = { source: { kind: 'codexHome' as const, home: 'user' as const }, activeServerDir: join(root, 'server'), env: createDirectSessionsEnv(home, { HAPPIER_CODEX_APP_SERVER_BIN: bin }), limit: 50 };
    try {
      for (const query of [{}, { searchTerm: '合成短标题' }, { searchTerm: id, searchMode: 'fast' as const }]) {
        const result = await listCodexSessionCandidates({ ...params, ...query });
        expect(result.candidates.find((candidate) => candidate.remoteSessionId === id)?.title).toBe('合成短标题');
        if (!('searchMode' in query)) {
          expect(result.candidates.find((candidate) => candidate.remoteSessionId === appOnlyId)?.title).toBe('合成短标题');
          expect(result.candidates.find((candidate) => candidate.remoteSessionId === appOnlyId)?.details?.codexLifecycle).toMatchObject({ state: 'unknown', eventAtMs: null });
        }
      }
      const fastAscii = await listCodexSessionCandidates({ ...params, searchTerm: 'unmatchedAsciiTitle', searchMode: 'fast' });
      expect(fastAscii.candidates).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps indexed titles bound to the selected home when profiles contain the same thread ID', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-index-homes-'));
    const activeServerDir = join(root, 'servers', 'cloud');
    const id = '01a0c7cf-6bea-7d50-927b-882a31974396';
    try {
      const lifecycleBody = ['task_started', 'task_complete'].map((type) => JSON.stringify({ type: 'event_msg', timestamp: new Date(Date.now() - 1000).toISOString(), payload: { type, turn_id: 'same-turn' } }) + '\n').join('');
      for (const [profile, day, title] of [['profile-a', '01', 'Other home'], ['profile-b', '02', 'Selected home']]) {
        const home = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'svc_1', profile!, 'codex', 'codex-home');
        await mkdir(join(home, 'sessions'), { recursive: true });
        await writeFile(join(home, 'sessions', `rollout-2026-01-${day}T00-00-00-${id}.jsonl`), sessionMetaLine({ id, cwd: '/synthetic' }) + lifecycleBody);
        await writeFile(join(home, 'session_index.jsonl'), JSON.stringify({ id, thread_name: title, updated_at: '2026-01-05T00:00:00Z' }) + '\n');
      }
      const result = await listCodexSessionCandidates({ source: { kind: 'codexHome', home: 'connectedService', connectedServiceId: 'svc_1' }, activeServerDir, env: {}, searchMode: 'fast', searchTerm: id, limit: 10 });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.title).toBe('Selected home');
      expect(result.candidates[0]?.details?.source).toMatchObject({ connectedServiceProfileId: 'profile-b' });
      expect(result.candidates[0]?.details?.codexLifecycle).toMatchObject({ state: 'unknown', eventAtMs: null });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('retains source conflicts when multiple app-server homes report one ID but only the winning home has rollout evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-lifecycle-source-conflict-'));
    const activeServerDir = join(root, 'servers', 'cloud');
    const homes = ['profile-a', 'profile-b'].map((profile) => join(activeServerDir, 'daemon', 'connected-services', 'homes', 'svc_1', profile, 'codex', 'codex-home'));
    const id = '11111111-1111-4111-8111-111111111111';
    try {
      for (const home of homes) await mkdir(join(home, 'sessions'), { recursive: true });
      const body = ['task_started', 'task_complete'].map((type) => JSON.stringify({ type: 'event_msg', timestamp: new Date(Date.now() - 1000).toISOString(), payload: { type, turn_id: 'turn' } }) + '\n').join('');
      await writeFile(join(homes[1]!, 'sessions', `rollout-2026-09-24T00-00-00-${id}.jsonl`), sessionMetaLine({ id, source: 'cli' }) + body);
      const params = { source: { kind: 'codexHome' as const, home: 'connectedService' as const, connectedServiceId: 'svc_1' }, activeServerDir, limit: 10 };
      const fast = await listCodexSessionCandidates({ ...params, env: {}, searchMode: 'fast' });
      expect(fast.candidates[0]?.details?.codexLifecycle).toMatchObject({ state: 'completed' });
      const binary = await writeFakeCodexAppServerThreadListScript({ dir: root, allowedCodexHomes: homes, nonArchivedThreads: [{ id, name: 'Same native ID', updatedAt: 500 }] });
      const merged = await listCodexSessionCandidates({ ...params, env: createCodexAppServerProcessEnv(binary, { CODEX_HOME: homes[0] }) });
      expect(merged.candidates).toHaveLength(1);
      expect(merged.candidates[0]?.details?.codexLifecycle).toMatchObject({ state: 'unknown', eventAtMs: null });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  // 真实文件目录与 App Server 子进程共同决定分页；变化必须拒绝旧 offset。
  async function orderedFixture() {
    const root = await mkdtemp(join(tmpdir(), 'happier-list-cursor-'));
    const home = join(root, 'codex');
    await mkdir(join(home, 'sessions'), { recursive: true });
    const files = ['a', 'b', 'c'].map((id) => join(home, 'sessions', `rollout-2026-01-01T00-00-00-${id}.jsonl`));
    for (const [index, file] of files.entries()) {
      await writeFile(file, sessionMetaLine({ id: ['a', 'b', 'c'][index], cwd: '/fixture' }));
      await utimes(file, 300 - index * 100, 300 - index * 100);
    }
    const bin = await writeFakeCodexAppServerThreadListScript({ dir: root, nonArchivedThreads: [] });
    return { files, root, params: {
      source: { kind: 'codexHome' as const, home: 'user' as const },
      activeServerDir: join(root, 'servers', 'one'),
      serverScope: 'https://one.example',
      env: createDirectSessionsEnv(home, { HAPPIER_CODEX_APP_SERVER_BIN: bin }), limit: 1,
    } };
  }

  it('excludes explicit child identities from both sources before pagination and fast search without title heuristics', async () => {
    const { files, root, params } = await orderedFixture();
    try {
      await writeFile(files[0], sessionMetaLine({ id: 'a', source: { subagent: { thread_spawn: { parent_thread_id: 'root' } } } }));
      await writeFile(files[1], sessionMetaLine({ id: 'b', source: 'cli' }));
      await writeFile(files[2], sessionMetaLine({ id: 'c', thread_source: 'subagent' }));
      const bin = await writeFakeCodexAppServerThreadListScript({ dir: root, nonArchivedThreads: [
        { id: 'a', name: 'Child without app source', updatedAt: 1000 },
        { id: 'b', source: { subAgent: { thread_spawn: { parent_thread_id: 'root', depth: 1 } } }, updatedAt: 900 },
        { id: 'c', name: 'Other child without app source', updatedAt: 800 },
        { id: 'visible', source: 'appServer', name: 'Investigate subagent behavior', updatedAt: 700 },
        { id: 'unknown', name: 'Ordinary accessible task', updatedAt: 600 },
      ] });
      const request = { ...params, env: createDirectSessionsEnv(params.env.CODEX_HOME!, { HAPPIER_CODEX_APP_SERVER_BIN: bin }) };
      const first = await listCodexSessionCandidates(request);
      expect(first.candidates.map((item) => item.remoteSessionId)).toEqual(['visible']);
      const second = await listCodexSessionCandidates({ ...request, cursor: first.nextCursor! });
      expect(second.candidates.map((item) => item.remoteSessionId)).toEqual(['unknown']);
      expect(second.nextCursor).toBeNull();
      const fast = await listCodexSessionCandidates({ ...request, searchMode: 'fast', searchTerm: 'a' });
      expect(fast.candidates).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['insert', 'delete', 'move-unread', 'move-read', 'replace-id'])('requires refresh after %s between pages', async (change) => {
    const { files, params } = await orderedFixture();
    const first = await listCodexSessionCandidates(params);
    expect(first.candidates.map((item) => item.remoteSessionId)).toEqual(['a']);
    if (change === 'delete' || change === 'replace-id') await unlink(files[0]);
    if (change === 'insert' || change === 'replace-id') {
      const file = files[0].replace('-a.jsonl', '-d.jsonl');
      await writeFile(file, sessionMetaLine({ id: 'd' }));
      await utimes(file, 400, 400);
    }
    if (change === 'move-unread') await utimes(files[2], 400, 400);
    if (change === 'move-read') await utimes(files[0], 50, 50);
    await expect(listCodexSessionCandidates({ ...params, cursor: first.nextCursor! }))
      .rejects.toMatchObject({ name: 'DirectSessionsCandidateCursorError' });
  });

  it('allows timestamp updates that preserve identity order and rejects cross-server cursors', async () => {
    const { files, params } = await orderedFixture();
    const first = await listCodexSessionCandidates(params);
    await utimes(files[0], 350, 350);
    const second = await listCodexSessionCandidates({ ...params, cursor: first.nextCursor! });
    expect(second.candidates.map((item) => item.remoteSessionId)).toEqual(['b']);
    await expect(listCodexSessionCandidates({ ...params, serverScope: 'https://two.example', cursor: first.nextCursor! }))
      .rejects.toMatchObject({ name: 'DirectSessionsCandidateCursorError' });
  });

  it.each(['broken', Buffer.from(JSON.stringify({ v: 1, kind: 'index', offset: 1 })).toString('base64url')])(
    'requires refresh instead of restarting for a legacy or malformed cursor', async (cursor) => {
      const { params } = await orderedFixture();
      await expect(listCodexSessionCandidates({ ...params, cursor }))
        .rejects.toMatchObject({ name: 'DirectSessionsCandidateCursorError' });
    },
  );

  it('uses one merged order even when overlapping App Server timestamps disagree with rollouts', async () => {
    const { root, params } = await orderedFixture();
    const bin = await writeFakeCodexAppServerThreadListScript({ dir: root, nonArchivedThreads: [
      { id: 'c', updatedAt: 500, name: 'C app title' },
      { id: 'd', updatedAt: 150, name: 'D app title' },
    ] });
    const request = { ...params, env: createDirectSessionsEnv(params.env.CODEX_HOME!, { HAPPIER_CODEX_APP_SERVER_BIN: bin }) };
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 8; page++) {
      const result = await listCodexSessionCandidates({ ...request, cursor });
      ids.push(...result.candidates.map((item) => item.remoteSessionId));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(ids).toEqual(['a', 'b', 'd', 'c']);
  });

  it('binds source, filter, and search mode while continuing fast cursors without a mode override', async () => {
    const { params } = await orderedFixture();
    const first = await listCodexSessionCandidates({ ...params, searchMode: 'fast' });
    expect((await listCodexSessionCandidates({ ...params, cursor: first.nextCursor! })).candidates[0]?.remoteSessionId).toBe('b');
    for (const override of [
      { searchMode: 'full' as const }, { searchTerm: 'a' },
      { activeServerDir: join(params.activeServerDir, 'other') },
      { source: { kind: 'codexHome' as const, home: 'user' as const, homePath: join(params.activeServerDir, 'empty') } },
    ]) {
      await expect(listCodexSessionCandidates({ ...params, ...override, cursor: first.nextCursor! }))
        .rejects.toMatchObject({ name: 'DirectSessionsCandidateCursorError' });
    }
    expect(first.nextCursor!.length).toBeLessThan(512);
    expect(Buffer.from(first.nextCursor!, 'base64url').toString()).not.toContain(params.env.CODEX_HOME);
  });

  it('requires refresh when App Server coverage recovers between pages', async () => {
    const { root, params } = await orderedFixture();
    const failedBin = await writeFakeCodexAppServerScript({ dir: root, fileName: 'failed-server.mjs', bodyLines: ['process.exit(1);'] });
    const first = await listCodexSessionCandidates({ ...params, env: createDirectSessionsEnv(params.env.CODEX_HOME!, { HAPPIER_CODEX_APP_SERVER_BIN: failedBin }) });
    expect(first.searchIncomplete).toBe(true);
    await expect(listCodexSessionCandidates({ ...params, cursor: first.nextCursor! }))
      .rejects.toMatchObject({ name: 'DirectSessionsCandidateCursorError' });
  });

  it('reports scan IO failure as retryable instead of issuing a cursor for an empty source', async () => {
    const { params } = await orderedFixture();
    const first = await listCodexSessionCandidates(params);
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return { ...actual, readdir: async (...args: Parameters<typeof actual.readdir>) => {
        if (String(args[0]).startsWith(params.env.CODEX_HOME!)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return actual.readdir(...args);
      } };
    });
    const { listCodexSessionCandidates: deniedList } = await import('./listCodexSessionCandidates');
    await expect(deniedList({ ...params, cursor: first.nextCursor! }))
      .rejects.toMatchObject({ name: 'DirectSessionsProviderUnavailableError' });
  });

  it.each(['readdir', 'stat', 'realpath', 'lstat'])('strict home enumeration reports %s failure without changing legacy resolver callers', async (operation) => {
    const { params } = await orderedFixture();
    const base = join(params.activeServerDir, 'daemon', 'connected-services', 'homes', 'svc');
    const homes = ['one', 'two'].map((profile) => join(base, profile, 'codex', 'codex-home'));
    for (const home of homes) await mkdir(join(home, 'sessions'), { recursive: true });
    const source = operation === 'realpath' || operation === 'lstat'
      ? { kind: 'codexHome' as const, home: 'connectedService' as const, connectedServiceId: 'svc', connectedServiceProfileId: 'two' }
      : { kind: 'codexHome' as const, home: 'connectedService' as const, connectedServiceId: 'svc' };
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      const deny = (op: string, path: unknown) => {
        if (operation === op && String(path) === (op === 'readdir' ? base : homes[1])) {
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        }
      };
      return { ...actual,
        readdir: (...args: Parameters<typeof actual.readdir>) => { deny('readdir', args[0]); return actual.readdir(...args); },
        stat: (...args: Parameters<typeof actual.stat>) => { deny('stat', args[0]); return actual.stat(...args); },
        realpath: (...args: Parameters<typeof actual.realpath>) => { deny('realpath', args[0]); return actual.realpath(...args); },
        lstat: (...args: Parameters<typeof actual.lstat>) => { deny('lstat', args[0]); return actual.lstat(...args); },
      };
    });
    vi.resetModules();
    const { resolveCodexHomeEntriesForDirectSessionsSource: legacyResolve } = await import('./resolveCodexHomeEntriesForDirectSessionsSource');
    await expect(legacyResolve({ source, activeServerDir: params.activeServerDir, env: params.env })).resolves.toHaveLength(operation === 'stat' ? 1 : 0);
    const { listCodexSessionCandidates: strictList } = await import('./listCodexSessionCandidates');
    await expect(strictList({ ...params, source, searchMode: 'fast' })).rejects.toMatchObject({ name: 'DirectSessionsProviderUnavailableError' });
  });

  it('rejects a changed winning home even when session identities and their order stay the same', async () => {
    const { params } = await orderedFixture();
    const base = join(params.activeServerDir, 'daemon', 'connected-services', 'homes', 'svc');
    const homes = ['one', 'two'].map((profile) => join(base, profile, 'codex', 'codex-home'));
    for (const home of homes) await mkdir(join(home, 'sessions'), { recursive: true });
    for (const [index, id] of ['a', 'b'].entries()) {
      const file = join(homes[0], 'sessions', `rollout-2026-01-01T00-00-00-${id}.jsonl`);
      await writeFile(file, sessionMetaLine({ id }));
      await utimes(file, 300 - index * 100, 300 - index * 100);
    }
    const request = { ...params, source: { kind: 'codexHome' as const, home: 'connectedService' as const, connectedServiceId: 'svc' }, searchMode: 'fast' as const };
    const first = await listCodexSessionCandidates(request);
    const replacement = join(homes[1], 'sessions', 'rollout-2026-02-01T00-00-00-a.jsonl');
    await writeFile(replacement, sessionMetaLine({ id: 'a' }));
    await utimes(replacement, 300, 300);
    await expect(listCodexSessionCandidates({ ...request, cursor: first.nextCursor! }))
      .rejects.toMatchObject({ name: 'DirectSessionsCandidateCursorError' });
  });

  it('lists sessions from CODEX_HOME with archived flags and paging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    const archivedDir = join(codexHome, 'archived_sessions');
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(archivedDir, { recursive: true });

    const session1 = '11111111-1111-1111-1111-111111111111';
    const session2 = '22222222-2222-2222-2222-222222222222';

    const s1a = join(sessionsDir, `rollout-2026-01-01T00-00-00-${session1}.jsonl`);
    const s1b = join(sessionsDir, `rollout-2026-01-02T00-00-00-${session1}.jsonl`);
    const s2 = join(archivedDir, `rollout-2026-01-03T00-00-00-${session2}.jsonl`);

    await writeFile(
      s1a,
      sessionMetaLine({ id: session1, timestamp: '2026-01-01T00:00:00.000Z', cwd: '/repo/one' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'hello' }] }),
      'utf8',
    );
    await writeFile(
      s1b,
      sessionMetaLine({ id: session1, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/one' })
        + responseItemLine({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'world' }] }),
      'utf8',
    );
    await writeFile(
      s2,
      sessionMetaLine({ id: session2, timestamp: '2026-01-03T00:00:00.000Z', cwd: '/repo/two' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'archived' }] }),
      'utf8',
    );

    await utimes(s1a, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));
    await utimes(s1b, new Date('2026-01-02T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'));
    await utimes(s2, new Date('2026-01-03T00:00:00.000Z'), new Date('2026-01-03T00:00:00.000Z'));

    const first = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 1,
    });

    expect(first.candidates.length).toBe(1);
    expect(first.candidates[0]?.remoteSessionId).toBe(session2);
    expect(first.candidates[0]?.archived).toBe(true);
    expect(first.candidates[0]?.activity).toBe('idle');
    expect(first.nextCursor).toBeTruthy();

    const second = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome),
      activeServerDir: join(root, 'servers', 'cloud'),
      cursor: first.nextCursor ?? undefined,
      limit: 10,
    });

    expect(second.candidates.map((c) => c.remoteSessionId)).toEqual([session1]);
    expect(second.candidates[0]?.archived).toBe(false);
    expect(second.candidates[0]?.title).toBe('hello');
    expect(second.candidates[0]?.activity).toBe('idle');
    expect(second.nextCursor).toBeNull();
  });

  it('reads only one bounded source header outside the requested page when no search term is provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-page-only-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const newestSessionId = 'aaaaaaaa-1111-1111-1111-111111111111';
    const middleSessionId = 'bbbbbbbb-1111-1111-1111-111111111111';
    const oldestSessionId = 'cccccccc-1111-1111-1111-111111111111';

    const newest = join(sessionsDir, `rollout-2026-01-03T00-00-00-${newestSessionId}.jsonl`);
    const middle = join(sessionsDir, `rollout-2026-01-02T00-00-00-${middleSessionId}.jsonl`);
    const oldest = join(sessionsDir, `rollout-2026-01-01T00-00-00-${oldestSessionId}.jsonl`);

    await writeFile(newest, sessionMetaLine({ id: newestSessionId, timestamp: '2026-01-03T00:00:00.000Z', cwd: '/repo/newest' }), 'utf8');
    await writeFile(middle, sessionMetaLine({ id: middleSessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/middle' }), 'utf8');
    await writeFile(oldest, sessionMetaLine({ id: oldestSessionId, timestamp: '2026-01-01T00:00:00.000Z', cwd: '/repo/oldest' }) + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'x'.repeat(256 * 1024) }] }), 'utf8');

    await utimes(newest, new Date('2026-01-03T00:00:00.000Z'), new Date('2026-01-03T00:00:00.000Z'));
    await utimes(middle, new Date('2026-01-02T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'));
    await utimes(oldest, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));

    let openedOutsidePage = 0;
    let bytesReadOutsidePage = 0;
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        open: async (filePath: Parameters<typeof actual.open>[0], ...args: Parameters<typeof actual.open> extends [any, ...infer Rest] ? Rest : never) => {
          if (String(filePath).includes(oldestSessionId)) {
            openedOutsidePage += 1;
            const handle = await actual.open(filePath, ...args);
            const read = handle.read.bind(handle);
            handle.read = async (...readArgs: any[]) => {
              const result = await (read as any)(...readArgs);
              bytesReadOutsidePage += result.bytesRead;
              return result;
            };
            return handle;
          }
          return actual.open(filePath, ...args);
        },
      };
    });

    const { listCodexSessionCandidates: listWithMockedFs } = await import('./listCodexSessionCandidates');

    const first = await listWithMockedFs({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 1,
    });

    expect(first.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: newestSessionId,
        details: expect.objectContaining({
          cwd: '/repo/newest',
        }),
      }),
    ]);
    expect(first.nextCursor).toBeTruthy();
    expect(openedOutsidePage).toBe(1);
    expect(bytesReadOutsidePage).toBeLessThanOrEqual(64 * 1024);
  });

  it('matches search terms against surfaced session titles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-title-search-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '33333333-3333-3333-3333-333333333333';
    const rollout = join(sessionsDir, `rollout-2026-01-04T00-00-00-${sessionId}.jsonl`);

    await writeFile(
      rollout,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-04T00:00:00.000Z', cwd: '/repo/three' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Unique Title Query' }] }),
      'utf8',
    );
    await utimes(rollout, new Date('2026-01-04T00:00:00.000Z'), new Date('2026-01-04T00:00:00.000Z'));

    // Search by title-only term that does NOT appear in sessionId or cwd
    const result = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 10,
      searchTerm: 'unique',
    });

    // Should match because 'unique' appears in the title 'Unique Title Query'
    // but NOT in sessionId '33333333-3333-3333-3333-333333333333' or cwd '/repo/three'
    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: sessionId,
        title: 'Unique Title Query',
      }),
    ]);
    expect(result.candidates.length).toBe(1);
    expect(result.nextCursor).toBeNull();
  });

  it('matches search terms against remoteSessionId and cwd (regression test)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-regression-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const session1 = 'aaaaaaaa-1111-1111-1111-111111111111';
    const session2 = 'bbbbbbbb-2222-2222-2222-222222222222';

    const rollout1 = join(sessionsDir, `rollout-2026-01-05T00-00-00-${session1}.jsonl`);
    const rollout2 = join(sessionsDir, `rollout-2026-01-06T00-00-00-${session2}.jsonl`);

    await writeFile(
      rollout1,
      sessionMetaLine({ id: session1, timestamp: '2026-01-05T00:00:00.000Z', cwd: '/workspace/frontend' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Build UI' }] }),
      'utf8',
    );
    await writeFile(
      rollout2,
      sessionMetaLine({ id: session2, timestamp: '2026-01-06T00:00:00.000Z', cwd: '/workspace/backend' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'API work' }] }),
      'utf8',
    );

    await utimes(rollout1, new Date('2026-01-05T00:00:00.000Z'), new Date('2026-01-05T00:00:00.000Z'));
    await utimes(rollout2, new Date('2026-01-06T00:00:00.000Z'), new Date('2026-01-06T00:00:00.000Z'));

    // Search by sessionId substring
    const bySessionId = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 10,
      searchTerm: 'aaaa',
    });
    expect(bySessionId.candidates.length).toBe(1);
    expect(bySessionId.candidates[0]?.remoteSessionId).toBe(session1);

    // Search by cwd substring
    const byCwd = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 10,
      searchTerm: 'frontend',
    });
    expect(byCwd.candidates.length).toBe(1);
    expect(byCwd.candidates[0]?.remoteSessionId).toBe(session1);
    expect(byCwd.candidates[0]?.details?.cwd).toBe('/workspace/frontend');
  });

  it('uses the current app-server title when a rollout-backed session has been renamed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-app-server-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '99999999-9999-9999-9999-999999999999';
    const rollout = join(sessionsDir, `rollout-2026-01-06T00-00-00-${sessionId}.jsonl`);
    await writeFile(
      rollout,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-06T00:00:00.000Z', cwd: '/repo/from-rollout' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Rollout title' }] }),
      'utf8',
    );
    await utimes(rollout, new Date('2026-01-06T00:00:00.000Z'), new Date('2026-01-06T00:00:00.000Z'));
    const fakeAppServer = await writeFakeCodexAppServerThreadListScript({
      dir: root,
      nonArchivedThreads: [{
        id: sessionId,
        preview: 'Thread from app-server',
        ephemeral: false,
        modelProvider: 'openai',
        createdAt: 1_736_000_000,
        updatedAt: 1_736_000_100,
        status: 'notLoaded',
        path: join(codexHome, 'sessions', `rollout-${sessionId}.jsonl`),
        cwd: '/repo/from-app-server',
        cliVersion: '0.0.0',
        source: 'vscode',
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: 'App-server title',
        turns: [],
      }],
    });

    const result = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome, { HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer }),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 10,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: sessionId,
        title: 'App-server title',
        archived: false,
        details: expect.objectContaining({
          cwd: '/repo/from-rollout',
        }),
      }),
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it('still lists rollout sessions when app-server returns an empty successful listing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-app-server-empty-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '88888888-8888-8888-8888-888888888888';
    const rollout = join(sessionsDir, `rollout-2026-01-07T00-00-00-${sessionId}.jsonl`);
    await writeFile(
      rollout,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-07T00:00:00.000Z', cwd: '/repo/fallback' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Fallback title' }] }),
      'utf8',
    );
    await utimes(rollout, new Date('2026-01-07T00:00:00.000Z'), new Date('2026-01-07T00:00:00.000Z'));

    const fakeAppServer = await writeFakeCodexAppServerThreadListScript({
      dir: root,
      nonArchivedThreads: [],
      archivedThreads: [],
    });

    const result = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome, { HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer }),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 10,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: sessionId,
        title: 'Fallback title',
        details: expect.objectContaining({ cwd: '/repo/fallback', source: { kind: 'codexHome', home: 'user', homePath: codexHome }, codexLifecycle: expect.objectContaining({ state: 'unknown', eventAtMs: null }) }),
      }),
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it('surfaces app-server-only candidates when rollout files are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-app-server-stable-time-'));
    const codexHome = join(root, 'codex-home');
    await mkdir(codexHome, { recursive: true });

    const sessionId = '77777777-7777-7777-7777-777777777777';
    const fakeAppServer = await writeFakeCodexAppServerThreadListScript({
      dir: root,
      nonArchivedThreads: [{
        id: sessionId,
        updatedAt: 1_736_000_100,
        cwd: '/repo/from-app-server',
        name: 'App-server title',
      }],
    });

    const result = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome, { HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer }),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 10,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: sessionId,
        title: 'App-server title',
        details: expect.objectContaining({
          cwd: '/repo/from-app-server',
          source: { kind: 'codexHome', home: 'user', homePath: codexHome },
        }),
      }),
    ]);
  });

  it('derives rollout fallback candidates from the earliest rollout and omits unverified app-server backend mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-rollout-fallback-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '66666666-6666-6666-6666-666666666666';
    const earliest = join(sessionsDir, `rollout-2026-01-08T00-00-00-${sessionId}.jsonl`);
    const latest = join(sessionsDir, `rollout-2026-01-09T00-00-00-${sessionId}.jsonl`);

    await writeFile(
      earliest,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-08T00:00:00.000Z', cwd: '/repo/earliest' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Earliest title' }] }),
      'utf8',
    );
    await writeFile(
      latest,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-09T00:00:00.000Z', cwd: '/repo/latest' })
        + responseItemLine({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Latest content' }] }),
      'utf8',
    );

    await utimes(earliest, new Date('2026-01-08T00:00:00.000Z'), new Date('2026-01-08T00:00:00.000Z'));
    await utimes(latest, new Date('2026-01-09T00:00:00.000Z'), new Date('2026-01-09T00:00:00.000Z'));

    const result = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 10,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: sessionId,
        title: 'Earliest title',
        createdAtMs: Date.parse('2026-01-08T00:00:00.000Z'),
        updatedAtMs: Date.parse('2026-01-09T00:00:00.000Z'),
        details: expect.objectContaining({
          source: { kind: 'codexHome', home: 'user', homePath: codexHome },
        }),
      }),
    ]);
    expect(result.candidates[0]?.details).toEqual(expect.objectContaining({ cwd: '/repo/latest', source: { kind: 'codexHome', home: 'user', homePath: codexHome }, codexLifecycle: expect.objectContaining({ state: 'unknown', eventAtMs: null }) }));
  });

  it('uses rollout filename chronology instead of mtime when choosing earliest and latest rollout files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-rollout-chronology-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const sessionId = '33333333-3333-3333-3333-333333333333';
    const earliest = join(sessionsDir, `rollout-2026-01-01T00-00-00-${sessionId}.jsonl`);
    const latest = join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);

    await writeFile(
      earliest,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-01T00:00:00.000Z', cwd: '/repo/earliest' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Earliest title' }] }),
      'utf8',
    );
    await writeFile(
      latest,
      sessionMetaLine({ id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/latest' })
        + responseItemLine({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Latest content' }] }),
      'utf8',
    );

    await utimes(earliest, new Date('2026-01-03T00:00:00.000Z'), new Date('2026-01-03T00:00:00.000Z'));
    await utimes(latest, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));

    const result = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 10,
    });

    expect(result.candidates[0]).toEqual(expect.objectContaining({
      title: 'Earliest title',
      createdAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
      updatedAtMs: Date.parse('2026-01-03T00:00:00.000Z'),
      details: expect.objectContaining({ cwd: '/repo/latest', source: { kind: 'codexHome', home: 'user', homePath: codexHome }, codexLifecycle: expect.objectContaining({ state: 'unknown', eventAtMs: null }) }),
    }));
  });

  it('lists mixed connected-service homes from rollout files regardless of app-server authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-partial-app-server-'));
    const activeServerDir = join(root, 'servers', 'cloud');
    const homesRoot = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'svc_1');
    const firstHome = join(homesRoot, 'profile-a', 'codex', 'codex-home');
    const secondHome = join(homesRoot, 'profile-b', 'codex', 'codex-home');
    await mkdir(firstHome, { recursive: true });
    await mkdir(join(secondHome, 'sessions'), { recursive: true });

    const appServerSessionId = '55555555-5555-5555-5555-555555555555';
    const rolloutSessionId = '44444444-4444-4444-4444-444444444444';
    const fallbackRollout = join(secondHome, 'sessions', `rollout-2026-01-10T00-00-00-${rolloutSessionId}.jsonl`);
    await writeFile(
      fallbackRollout,
      sessionMetaLine({ id: rolloutSessionId, timestamp: '2026-01-10T00:00:00.000Z', cwd: '/repo/fallback-home' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Fallback home title' }] }),
      'utf8',
    );
    await utimes(fallbackRollout, new Date('2026-01-10T00:00:00.000Z'), new Date('2026-01-10T00:00:00.000Z'));

    const fakeAppServer = await writeFakeCodexAppServerThreadListScript({
      dir: root,
      allowedCodexHomes: [firstHome],
      nonArchivedThreads: [{
        id: appServerSessionId,
        createdAt: 1_736_000_000,
        updatedAt: 1_736_000_100,
        cwd: '/repo/app-server-home',
        name: 'App-server title',
      }],
    });

    const result = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'connectedService', connectedServiceId: 'svc_1' },
      env: createCodexAppServerProcessEnv(fakeAppServer, { CODEX_HOME: firstHome }),
      activeServerDir,
      limit: 10,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: rolloutSessionId,
        details: expect.objectContaining({
          cwd: '/repo/fallback-home',
          source: {
            kind: 'codexHome',
            home: 'connectedService',
            connectedServiceId: 'svc_1',
            connectedServiceProfileId: 'profile-b',
            homePath: secondHome,
          },
          codexLifecycle: expect.objectContaining({ state: 'unknown', eventAtMs: null }),
        }),
      }),
      expect.objectContaining({
        remoteSessionId: appServerSessionId,
        title: 'App-server title',
        details: expect.objectContaining({
          cwd: '/repo/app-server-home',
          source: expect.objectContaining({
            kind: 'codexHome',
            home: 'connectedService',
            connectedServiceId: 'svc_1',
            connectedServiceProfileId: 'profile-a',
          }),
        }),
      }),
    ]);
  });

  it('uses an exact connected-service homePath without scanning all service profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-exact-home-'));
    const activeServerDir = join(root, 'servers', 'cloud');
    const homesRoot = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'svc_1');
    const exactHome = join(homesRoot, 'profile-b', 'codex', 'codex-home');
    await mkdir(join(exactHome, 'sessions'), { recursive: true });

    const exactSessionId = '22222222-2222-2222-2222-222222222222';
    const rollout = join(exactHome, 'sessions', `rollout-2026-01-10T00-00-00-${exactSessionId}.jsonl`);
    await writeFile(
      rollout,
      sessionMetaLine({ id: exactSessionId, timestamp: '2026-01-10T00:00:00.000Z', cwd: '/repo/exact-home' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Exact home title' }] }),
      'utf8',
    );

    const result = await listCodexSessionCandidates({
      source: {
        kind: 'codexHome',
        home: 'connectedService',
        connectedServiceId: 'svc_1',
        homePath: exactHome,
      },
      env: {} as NodeJS.ProcessEnv,
      activeServerDir,
      limit: 10,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: exactSessionId,
        details: expect.objectContaining({
          cwd: '/repo/exact-home',
          source: expect.objectContaining({
            kind: 'codexHome',
            home: 'connectedService',
            connectedServiceId: 'svc_1',
            connectedServiceProfileId: 'profile-b',
          }),
        }),
      }),
    ]);
  });

  it('uses an exact connected-service materialized homePath for isolated Codex auth homes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-materialized-home-'));
    const activeServerDir = join(root, 'servers', 'cloud');
    const exactHome = join(activeServerDir, 'daemon', 'connected-services', 'materialized', 'csm_session_1', 'codex', 'codex-home');
    await mkdir(join(exactHome, 'sessions'), { recursive: true });

    const exactSessionId = '33333333-3333-3333-3333-333333333333';
    const rollout = join(exactHome, 'sessions', `rollout-2026-01-10T00-00-00-${exactSessionId}.jsonl`);
    await writeFile(
      rollout,
      sessionMetaLine({ id: exactSessionId, timestamp: '2026-01-10T00:00:00.000Z', cwd: '/repo/materialized-home' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Materialized home title' }] }),
      'utf8',
    );

    const result = await listCodexSessionCandidates({
      source: {
        kind: 'codexHome',
        home: 'connectedService',
        connectedServiceId: 'svc_1',
        connectedServiceProfileId: 'profile-b',
        homePath: exactHome,
      },
      env: {} as NodeJS.ProcessEnv,
      activeServerDir,
      limit: 10,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: exactSessionId,
        details: expect.objectContaining({
          cwd: '/repo/materialized-home',
          source: expect.objectContaining({
            kind: 'codexHome',
            home: 'connectedService',
            connectedServiceId: 'svc_1',
            connectedServiceProfileId: 'profile-b',
            homePath: exactHome,
          }),
        }),
      }),
    ]);
  });

  it('uses an exact connected-service materialized homePath from the daemon materialization root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-daemon-materialized-home-'));
    const activeServerDir = join(root, 'servers', 'cloud');
    const exactHome = join(root, 'daemon', 'connected-services', 'materialized', 'csm_session_1', 'codex', 'codex-home');
    await mkdir(join(exactHome, 'sessions'), { recursive: true });

    const exactSessionId = '66666666-6666-6666-6666-666666666666';
    const rollout = join(exactHome, 'sessions', `rollout-2026-01-10T00-00-00-${exactSessionId}.jsonl`);
    await writeFile(
      rollout,
      sessionMetaLine({ id: exactSessionId, timestamp: '2026-01-10T00:00:00.000Z', cwd: '/repo/daemon-materialized-home' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Daemon materialized home title' }] }),
      'utf8',
    );

    const result = await listCodexSessionCandidates({
      source: {
        kind: 'codexHome',
        home: 'connectedService',
        connectedServiceId: 'svc_1',
        connectedServiceProfileId: 'profile-b',
        homePath: exactHome,
      },
      env: {} as NodeJS.ProcessEnv,
      activeServerDir,
      limit: 10,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: exactSessionId,
        details: expect.objectContaining({
          cwd: '/repo/daemon-materialized-home',
          source: expect.objectContaining({
            kind: 'codexHome',
            home: 'connectedService',
            connectedServiceId: 'svc_1',
            connectedServiceProfileId: 'profile-b',
            homePath: exactHome,
          }),
        }),
      }),
    ]);
  });

  it('rejects materialized connected-service homePath symlinks that escape the materialized root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-materialized-symlink-'));
    const activeServerDir = join(root, 'servers', 'cloud');
    const outsideHome = join(root, 'outside-codex-home');
    await mkdir(join(outsideHome, 'sessions'), { recursive: true });

    const exactHome = join(activeServerDir, 'daemon', 'connected-services', 'materialized', 'csm_session_1', 'codex', 'codex-home');
    await mkdir(join(exactHome, '..'), { recursive: true });
    await symlink(outsideHome, exactHome);

    const exactSessionId = '77777777-7777-7777-7777-777777777777';
    const rollout = join(outsideHome, 'sessions', `rollout-2026-01-10T00-00-00-${exactSessionId}.jsonl`);
    await writeFile(
      rollout,
      sessionMetaLine({ id: exactSessionId, timestamp: '2026-01-10T00:00:00.000Z', cwd: '/repo/escaped-home' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Escaped home title' }] }),
      'utf8',
    );

    const result = await listCodexSessionCandidates({
      source: {
        kind: 'codexHome',
        home: 'connectedService',
        connectedServiceId: 'svc_1',
        connectedServiceProfileId: 'profile-b',
        homePath: exactHome,
      },
      env: {} as NodeJS.ProcessEnv,
      activeServerDir,
      limit: 10,
    });

    expect(result.candidates).toEqual([]);
  });

  it('uses an exact connected-service group homePath', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-group-home-'));
    const activeServerDir = join(root, 'servers', 'cloud');
    const exactHome = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'svc_1', '__groups', 'main', 'codex', 'codex-home');
    await mkdir(join(exactHome, 'sessions'), { recursive: true });

    const exactSessionId = '99999999-9999-9999-9999-999999999999';
    const rollout = join(exactHome, 'sessions', `rollout-2026-01-10T00-00-00-${exactSessionId}.jsonl`);
    await writeFile(
      rollout,
      sessionMetaLine({ id: exactSessionId, timestamp: '2026-01-10T00:00:00.000Z', cwd: '/repo/group-home' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Group home title' }] }),
      'utf8',
    );

    const result = await listCodexSessionCandidates({
      source: {
        kind: 'codexHome',
        home: 'connectedService',
        connectedServiceId: 'svc_1',
        homePath: exactHome,
      },
      env: {} as NodeJS.ProcessEnv,
      activeServerDir,
      limit: 10,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        remoteSessionId: exactSessionId,
        details: expect.objectContaining({
          cwd: '/repo/group-home',
          source: expect.objectContaining({
            kind: 'codexHome',
            home: 'connectedService',
            connectedServiceId: 'svc_1',
            connectedServiceGroupId: 'main',
          }),
        }),
      }),
    ]);
  });

  it('keeps page-2 listing stable when rollout-backed and app-server-only candidates are merged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-merged-page-2-'));
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const rolloutSessionId = '11111111-1111-1111-1111-111111111111';
    const rollout = join(sessionsDir, `rollout-2026-01-01T00-00-00-${rolloutSessionId}.jsonl`);
    await writeFile(
      rollout,
      sessionMetaLine({ id: rolloutSessionId, timestamp: '2026-01-01T00:00:00.000Z', cwd: '/repo/rollout-only' })
        + responseItemLine({ type: 'message', role: 'user', content: [{ type: 'text', text: 'Rollout only title' }] }),
      'utf8',
    );
    await utimes(rollout, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));

    const appServerSessionId = 'thread-appserver-only';
    const fakeAppServer = await writeFakeCodexAppServerThreadListScript({
      dir: root,
      nonArchivedThreads: [{
        id: appServerSessionId,
        createdAt: 1_736_000_050,
        updatedAt: 1_736_000_050,
        cwd: '/repo/app-server-only',
        name: 'App-server only title',
      }],
    });

    const first = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome, { HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer }),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 1,
    });
    expect(first.candidates).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();

    const second = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome, { HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer }),
      activeServerDir: join(root, 'servers', 'cloud'),
      cursor: first.nextCursor ?? undefined,
      limit: 1,
    });

    expect(second.candidates.map((candidate) => candidate.remoteSessionId)).toEqual([
      first.candidates[0]?.remoteSessionId === rolloutSessionId ? appServerSessionId : rolloutSessionId,
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('disposes timed-out app-server listing subprocesses instead of leaking them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-direct-list-timeout-dispose-'));
    const codexHome = join(root, 'codex-home');
    await mkdir(codexHome, { recursive: true });
    const pidFile = join(root, 'pid.txt');
    const fakeAppServer = join(root, 'fake-codex-app-server-timeout.mjs');
    const script = [
      '#!/usr/bin/env node',
      'import { writeFile } from "node:fs/promises";',
      'import readline from "node:readline";',
      `const pidFile = ${JSON.stringify(pidFile)};`,
      'await writeFile(pidFile, String(process.pid), "utf8");',
      'const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });',
      'for await (const line of rl) {',
      '  if (!line.trim()) continue;',
      '  const msg = JSON.parse(line);',
      '  if (msg.method === "initialize") {',
      '    process.stdout.write(JSON.stringify({ id: msg.id, result: { serverInfo: { name: "fake", version: "0.0.0" } } }) + "\\n");',
      '    continue;',
      '  }',
      '  if (msg.method === "initialized") continue;',
      '  if (msg.method === "thread/list") { await new Promise(() => {}); }',
      '}',
    ].join('\n');
    await writeFile(fakeAppServer, script, { encoding: 'utf8', mode: 0o755 });

    const result = await listCodexSessionCandidates({
      source: { kind: 'codexHome', home: 'user' },
      env: createDirectSessionsEnv(codexHome, {
        HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer,
        HAPPIER_CODEX_DIRECT_SESSIONS_APP_SERVER_LIST_TIMEOUT_MS: '100',
      }),
      activeServerDir: join(root, 'servers', 'cloud'),
      limit: 10,
    });

    expect(result.candidates).toEqual([]);

    let pid = Number.NaN;
    await waitForCondition(async () => {
      try {
        pid = Number.parseInt((await readFile(pidFile, 'utf8')).trim(), 10);
        return Number.isFinite(pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    }, {
      timeoutMs: 5_000,
      intervalMs: 25,
      label: 'timed-out Codex app-server subprocess to publish its pid',
    });

    await waitForCondition(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, {
      timeoutMs: 5_000,
      intervalMs: 25,
      label: 'timed-out Codex app-server subprocess to exit',
    });
  });
});
