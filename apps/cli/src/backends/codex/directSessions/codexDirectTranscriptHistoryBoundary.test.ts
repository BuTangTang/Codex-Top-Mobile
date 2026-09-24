import { appendFile, mkdir, mkdtemp, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { decodeCodexDirectForwardCursor, encodeCodexDirectForwardCursor } from './codexDirectForwardCursor';
import { readAfterCodexTranscript } from './readAfterCodexTranscript';
import { pageCodexTranscript } from './pageCodexTranscript';

const readFailure = vi.hoisted(() => ({ path: '', code: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    if (String(args[0]) !== readFailure.path) return actual.open(...args);
    const error = Object.assign(new Error('Synthetic file read failure'), { code: readFailure.code });
    if (readFailure.code !== 'EIO' && readFailure.code !== 'SHORT_READ') throw error;
    const handle = await actual.open(...args);
    if (readFailure.code === 'SHORT_READ') {
      vi.spyOn(handle, 'read').mockResolvedValueOnce({ bytesRead: 0, buffer: Buffer.alloc(0) });
    } else {
      vi.spyOn(handle, 'read').mockRejectedValue(error);
    }
    return handle;
  } };
});

describe('Codex direct history read availability', () => {
  it.each(['ENOENT', 'EACCES', 'EIO', 'SHORT_READ'] as const)('does not accept empty history when the OS reports %s after discovery', async (code) => {
    const fixture = await createFixture(`availability-${code}`);
    await writeFile(fixture.filePath, sessionMetaLine(`availability-${code}`) + assistantLine('retained history'));
    const params = { source: { kind: 'codexHome', home: 'user' } as const, env: { CODEX_HOME: fixture.codexHome },
      activeServerDir: fixture.root, remoteSessionId: `availability-${code}`, maxBytes: 4096, maxItems: 10 };
    const initial = await readAfterCodexTranscript({ ...params, cursor: 'tail' });
    // 只控制 OS 文件边界，发现、游标、分页和投影均执行真实实现。
    readFailure.path = fixture.filePath;
    readFailure.code = code;
    try {
      await expect(pageCodexTranscript({ ...params, direction: 'older', cursor: 'accepted-older' })).resolves.toMatchObject({
        historyAvailability: 'unavailable', items: [], nextCursor: 'accepted-older', hasMore: true,
      });
      await expect(readAfterCodexTranscript({ ...params, cursor: initial.nextCursor! })).resolves.toMatchObject({
        historyAvailability: 'unavailable', items: [], nextCursor: initial.nextCursor, truncated: false,
      });
    } finally {
      readFailure.path = '';
      readFailure.code = '';
    }
  });

  it('distinguishes a readable empty rollout from an unavailable source', async () => {
    const fixture = await createFixture('readable-empty');
    await writeFile(fixture.filePath, '');
    const params = { source: { kind: 'codexHome', home: 'user' } as const, env: { CODEX_HOME: fixture.codexHome },
      activeServerDir: fixture.root, remoteSessionId: 'readable-empty', maxBytes: 4096, maxItems: 10 };
    await expect(pageCodexTranscript({ ...params, direction: 'older' })).resolves.toMatchObject({
      historyAvailability: 'available', items: [], hasMore: false,
    });
    await expect(readAfterCodexTranscript({ ...params, cursor: 'tail' })).resolves.toMatchObject({ historyAvailability: 'available' });
  });
});

function sessionMetaLine(sessionId: string): string {
  return `${JSON.stringify({
    type: 'session_meta',
    payload: { id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: '/repo/history-boundary' },
  })}\n`;
}

function assistantLine(text: string, timestamp = '2026-01-02T00:00:01.000Z'): string {
  return `${JSON.stringify({
    type: 'response_item',
    timestamp,
    payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text }] },
  })}\n`;
}

function spawnedChildLine(parentThreadId: string, childThreadId: string): string {
  return `${JSON.stringify({
    type: 'event_msg',
    timestamp: '2026-01-02T00:00:02.000Z',
    payload: {
      type: 'collab_agent_spawn_end',
      sender_thread_id: parentThreadId,
      new_thread_id: childThreadId,
      new_agent_nickname: 'Lovelace',
      new_agent_role: 'explorer',
      prompt: 'inspect the repo',
    },
  })}\n`;
}

async function createFixture(sessionId: string): Promise<Readonly<{
  root: string;
  codexHome: string;
  sessionsDir: string;
  filePath: string;
}>> {
  const root = await mkdtemp(join(tmpdir(), 'happier-codex-history-boundary-'));
  const codexHome = join(root, 'codex-home');
  const sessionsDir = join(codexHome, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  return {
    root,
    codexHome,
    sessionsDir,
    filePath: join(sessionsDir, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`),
  };
}

async function readAfter(params: Readonly<{
  root: string;
  codexHome: string;
  sessionId: string;
  cursor: string;
}>) {
  return readAfterCodexTranscript({
    source: { kind: 'codexHome', home: 'user' },
    env: { CODEX_HOME: params.codexHome } as NodeJS.ProcessEnv,
    activeServerDir: join(params.root, 'servers', 'cloud'),
    remoteSessionId: params.sessionId,
    cursor: params.cursor,
    maxBytes: 1024 * 1024,
    maxItems: 100,
  });
}

function expectOnlyText(items: readonly unknown[], expected: string): void {
  const serialized = JSON.stringify(items);
  expect(serialized).toContain(expected);
}

describe('Codex direct transcript durable history boundary', () => {
  it('upgrades an offset-only v4 cursor by baselining current history instead of trusting it', async () => {
    const sessionId = 'legacy-v4-cursor-session';
    const fixture = await createFixture(sessionId);
    const original = sessionMetaLine(sessionId) + assistantLine('history before v4 cursor');
    await writeFile(fixture.filePath, original, 'utf8');
    const legacyCursor = encodeCodexDirectForwardCursor({
      v: 4,
      kind: 'codexForwardStreamVector',
      streams: [{
        fileRelPath: `sessions/rollout-2026-01-02T00-00-00-${sessionId}.jsonl`,
        nextOffsetBytes: Buffer.byteLength(original, 'utf8'),
        subIndex: 0,
      }],
    });
    await appendFile(fixture.filePath, assistantLine('untrusted during cursor upgrade'), 'utf8');

    const upgraded = await readAfter({ ...fixture, sessionId, cursor: legacyCursor });
    expect(upgraded.items).toEqual([]);
    expect(upgraded.truncated).toBe(true);
    const decoded = decodeCodexDirectForwardCursor(upgraded.nextCursor!);
    expect(decoded?.v).toBe(7);

    await appendFile(fixture.filePath, assistantLine('live after cursor upgrade', '2026-01-02T00:00:05.000Z'), 'utf8');
    const live = await readAfter({ ...fixture, sessionId, cursor: upgraded.nextCursor! });
    expectOnlyText(live.items, 'live after cursor upgrade');
    expect(JSON.stringify(live.items)).not.toContain('untrusted during cursor upgrade');
  });

  it('fails closed when the rollout at the same path is replaced, then emits only later appends', async () => {
    const sessionId = 'same-path-replacement-session';
    const fixture = await createFixture(sessionId);
    await writeFile(fixture.filePath, sessionMetaLine(sessionId) + assistantLine('old original history'), 'utf8');

    const tail = await readAfter({ ...fixture, sessionId, cursor: 'tail' });
    const replacementPath = join(fixture.sessionsDir, 'replacement.jsonl');
    await writeFile(
      replacementPath,
      sessionMetaLine(sessionId)
        + assistantLine('replacement history')
        + assistantLine('more replacement history beyond the old cursor', '2026-01-02T00:00:02.000Z'),
      'utf8',
    );
    await unlink(fixture.filePath);
    await rename(replacementPath, fixture.filePath);

    const replaced = await readAfter({ ...fixture, sessionId, cursor: tail.nextCursor! });
    expect(replaced.items).toEqual([]);
    expect(replaced.truncated).toBe(true);
    expect(replaced.nextCursor).toBeTruthy();

    await appendFile(fixture.filePath, assistantLine('live after replacement', '2026-01-02T00:00:03.000Z'), 'utf8');
    const live = await readAfter({ ...fixture, sessionId, cursor: replaced.nextCursor! });
    expectOnlyText(live.items, 'live after replacement');
    expect(JSON.stringify(live.items)).not.toContain('replacement history');
  });

  it('detects an in-place same-length rewrite even when the filesystem object identity is unchanged', async () => {
    const sessionId = 'same-inode-rewrite-session';
    const fixture = await createFixture(sessionId);
    const original = sessionMetaLine(sessionId) + assistantLine('original-boundary');
    const rewritten = sessionMetaLine(sessionId) + assistantLine('replaced-boundary');
    expect(Buffer.byteLength(rewritten, 'utf8')).toBe(Buffer.byteLength(original, 'utf8'));
    await writeFile(fixture.filePath, original, 'utf8');

    const tail = await readAfter({ ...fixture, sessionId, cursor: 'tail' });
    await writeFile(fixture.filePath, rewritten, 'utf8');

    const replaced = await readAfter({ ...fixture, sessionId, cursor: tail.nextCursor! });
    expect(replaced.items).toEqual([]);
    expect(replaced.truncated).toBe(true);

    await appendFile(fixture.filePath, assistantLine('live after in-place rewrite'), 'utf8');
    const live = await readAfter({ ...fixture, sessionId, cursor: replaced.nextCursor! });
    expectOnlyText(live.items, 'live after in-place rewrite');
    expect(JSON.stringify(live.items)).not.toContain('replaced-boundary');
  });

  it('fails closed when a rollout is truncated, then resumes at the new durable tail', async () => {
    const sessionId = 'truncated-rollout-session';
    const fixture = await createFixture(sessionId);
    await writeFile(
      fixture.filePath,
      sessionMetaLine(sessionId) + assistantLine('old history with enough bytes to exceed the replacement'),
      'utf8',
    );

    const tail = await readAfter({ ...fixture, sessionId, cursor: 'tail' });
    await writeFile(fixture.filePath, sessionMetaLine(sessionId), 'utf8');

    const truncated = await readAfter({ ...fixture, sessionId, cursor: tail.nextCursor! });
    expect(truncated.items).toEqual([]);
    expect(truncated.truncated).toBe(true);

    await appendFile(fixture.filePath, assistantLine('live after truncation'), 'utf8');
    const live = await readAfter({ ...fixture, sessionId, cursor: truncated.nextCursor! });
    expectOnlyText(live.items, 'live after truncation');
  });

  it('baselines a rotated rollout without importing the replacement file history', async () => {
    const sessionId = 'rotated-rollout-session';
    const fixture = await createFixture(sessionId);
    await writeFile(fixture.filePath, sessionMetaLine(sessionId) + assistantLine('old rotated-away history'), 'utf8');

    const tail = await readAfter({ ...fixture, sessionId, cursor: 'tail' });
    await unlink(fixture.filePath);
    const rotatedPath = join(fixture.sessionsDir, `rollout-2026-01-02T00-10-00-${sessionId}.jsonl`);
    await writeFile(rotatedPath, sessionMetaLine(sessionId) + assistantLine('history in rotated replacement'), 'utf8');

    const rotated = await readAfter({ ...fixture, sessionId, cursor: tail.nextCursor! });
    expect(rotated.items).toEqual([]);
    expect(rotated.truncated).toBe(true);

    await appendFile(rotatedPath, assistantLine('live after rotation', '2026-01-02T00:10:01.000Z'), 'utf8');
    const live = await readAfter({ ...fixture, sessionId, cursor: rotated.nextCursor! });
    expectOnlyText(live.items, 'live after rotation');
    expect(JSON.stringify(live.items)).not.toContain('history in rotated replacement');
  });

  it('keeps a parseable but unterminated final JSONL line behind the boundary until its newline arrives', async () => {
    const sessionId = 'partial-final-line-session';
    const fixture = await createFixture(sessionId);
    const complete = assistantLine('completed after tail').trimEnd();
    await writeFile(fixture.filePath, sessionMetaLine(sessionId), 'utf8');

    const tail = await readAfter({ ...fixture, sessionId, cursor: 'tail' });
    await appendFile(fixture.filePath, complete, 'utf8');

    const partial = await readAfter({ ...fixture, sessionId, cursor: tail.nextCursor! });
    expect(partial.items).toEqual([]);
    await appendFile(fixture.filePath, '\n', 'utf8');

    const completed = await readAfter({ ...fixture, sessionId, cursor: partial.nextCursor! });
    expectOnlyText(completed.items, 'completed after tail');
    const idle = await readAfter({ ...fixture, sessionId, cursor: completed.nextCursor! });
    expect(idle.items).toEqual([]);
  });

  it('resumes a known child rollout exactly from its persisted stream boundary', async () => {
    const sessionId = 'known-child-parent-session';
    const childThreadId = 'known-child-thread';
    const fixture = await createFixture(sessionId);
    const childPath = join(fixture.sessionsDir, `rollout-2026-01-02T00-00-01-${childThreadId}.jsonl`);
    await writeFile(fixture.filePath, sessionMetaLine(sessionId) + spawnedChildLine(sessionId, childThreadId), 'utf8');
    await writeFile(childPath, assistantLine('known child history'), 'utf8');

    const tail = await readAfter({ ...fixture, sessionId, cursor: 'tail' });
    const decoded = decodeCodexDirectForwardCursor(tail.nextCursor!);
    expect(decoded?.kind).toBe('codexForwardStreamVector');
    if (decoded?.kind !== 'codexForwardStreamVector') throw new Error('expected stream vector cursor');
    expect(decoded.v).toBe(7);
    expect(decoded.streams.some((stream) => stream.fileRelPath.endsWith(`${childThreadId}.jsonl`))).toBe(true);
    if (decoded.v !== 7) throw new Error('expected durable stream vector cursor');
    expect(decoded.streams.every((stream) => /^[a-f0-9]{64}$/.test(stream.fileIdentity))).toBe(true);
    expect(decoded.streams.every((stream) => /^[a-f0-9]{64}$/.test(stream.contentFingerprint))).toBe(true);

    await appendFile(childPath, assistantLine('known child live append', '2026-01-02T00:00:03.000Z'), 'utf8');
    const live = await readAfter({ ...fixture, sessionId, cursor: tail.nextCursor! });
    expectOnlyText(live.items, 'known child live append');
    expect(JSON.stringify(live.items)).not.toContain('known child history');
    const idle = await readAfter({ ...fixture, sessionId, cursor: live.nextCursor! });
    expect(idle.items).toEqual([]);
  });

  it('baselines a historically discovered child file that was absent from the persisted vector', async () => {
    const sessionId = 'historical-child-parent-session';
    const childThreadId = 'historical-child-thread';
    const fixture = await createFixture(sessionId);
    const childPath = join(fixture.sessionsDir, `rollout-2026-01-02T00-00-01-${childThreadId}.jsonl`);
    await writeFile(fixture.filePath, sessionMetaLine(sessionId) + spawnedChildLine(sessionId, childThreadId), 'utf8');

    const tail = await readAfter({ ...fixture, sessionId, cursor: 'tail' });
    await writeFile(childPath, assistantLine('late-discovered child history'), 'utf8');

    const discovered = await readAfter({ ...fixture, sessionId, cursor: tail.nextCursor! });
    expect(discovered.items).toEqual([]);
    expect(discovered.truncated).toBe(true);

    await appendFile(childPath, assistantLine('late-discovered child live append', '2026-01-02T00:00:04.000Z'), 'utf8');
    const live = await readAfter({ ...fixture, sessionId, cursor: discovered.nextCursor! });
    expectOnlyText(live.items, 'late-discovered child live append');
    expect(JSON.stringify(live.items)).not.toContain('late-discovered child history');
  });

  it('adopts a genuinely new child created by a post-boundary spawn exactly once', async () => {
    const sessionId = 'new-child-parent-session';
    const childThreadId = 'new-child-thread';
    const fixture = await createFixture(sessionId);
    const childPath = join(fixture.sessionsDir, `rollout-2026-01-02T00-00-01-${childThreadId}.jsonl`);
    await writeFile(fixture.filePath, sessionMetaLine(sessionId), 'utf8');

    const tail = await readAfter({ ...fixture, sessionId, cursor: 'tail' });
    await appendFile(fixture.filePath, spawnedChildLine(sessionId, childThreadId), 'utf8');
    await writeFile(childPath, assistantLine('genuinely new child output'), 'utf8');

    const live = await readAfter({ ...fixture, sessionId, cursor: tail.nextCursor! });
    expectOnlyText(live.items, 'genuinely new child output');
    expect(live.truncated).toBe(false);
    const idle = await readAfter({ ...fixture, sessionId, cursor: live.nextCursor! });
    expect(idle.items).toEqual([]);
  });
});
