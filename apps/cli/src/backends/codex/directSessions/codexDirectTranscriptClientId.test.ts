import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { pageCodexTranscript } from './pageCodexTranscript';
import { readAfterCodexTranscript } from './readAfterCodexTranscript';
import { decodeCodexDirectForwardCursor, encodeCodexDirectForwardCursor } from './codexDirectForwardCursor';
import { decodeCodexDirectBackwardCursor, encodeCodexDirectBackwardCursor } from './codexDirectTranscriptBackwardCursor';

type HistoryMode = 'legacy' | 'paginated';

// 合成向量依据 openai/codex 0e2f848bf4a4e8d41a02d848a851ba126c09d185：
// protocol/src/{protocol,items,legacy_events}.rs 和 rollout/src/policy.rs。
/** 为合成事件附加固定时间和换行，形成可按字节分页的 JSONL 记录。 */
function line(type: string, payload: Record<string, unknown>, second = 1): string {
  return `${JSON.stringify({ type, timestamp: `2026-09-23T00:00:0${second}.000Z`, payload })}\n`;
}

/** 生成不带客户端 ID 的模型输入副本，用于验证原生回显不会产生第二份气泡。 */
function responseUserLine(): string {
  return line('response_item', {
    type: 'message', role: 'user', content: [{ type: 'input_text', text: 'synthetic repeated input' }],
  });
}

/** 按已核实的两种原生格式生成用户事件，同时支持缺失客户端 ID 的兼容样例。 */
function userEventLine(mode: HistoryMode, clientId?: string, second = 1): string {
  return line('event_msg', mode === 'legacy'
    ? { type: 'user_message', message: 'synthetic repeated input', ...(clientId ? { client_id: clientId } : {}) }
    : {
      type: 'item_completed', thread_id: 'synthetic-thread', turn_id: 'synthetic-turn',
      started_at_ms: 0, completed_at_ms: second * 1000,
      item: {
        type: 'UserMessage', id: `native-item-${second}`,
        ...(clientId ? { client_id: clientId } : {}),
        content: [{ type: 'text', text: 'synthetic repeated input', text_elements: [] }],
      },
    }, second);
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 在独立临时目录建立 rollout 和公共读取参数，避免测试读取真实 Codex 会话。 */
async function createRollout(historyMode?: HistoryMode, extraMeta: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'happier-codex-client-id-'));
  roots.push(root);
  const codexHome = join(root, 'codex-home');
  await mkdir(join(codexHome, 'sessions'), { recursive: true });
  const remoteSessionId = '11111111-1111-1111-1111-111111111111';
  const filePath = join(codexHome, 'sessions', `rollout-2026-09-23T00-00-00-${remoteSessionId}.jsonl`);
  await writeFile(filePath, line('session_meta', {
    ...extraMeta,
    id: remoteSessionId,
    ...(historyMode ? { history_mode: historyMode } : {}),
  }, 0));
  const params = {
    source: { kind: 'codexHome', home: 'user' } as const,
    env: { CODEX_HOME: codexHome },
    activeServerDir: join(root, 'servers', 'synthetic'),
    remoteSessionId,
    maxBytes: 1024 * 1024,
    maxItems: 1,
  };
  return { filePath, params };
}

describe('Codex direct transcript client message IDs', () => {
  it('preserves explicit main-thread lifecycle facts and never promotes assistant text or tool failure', async () => {
    const { filePath, params } = await createRollout('legacy');
    const tail = await readAfterCodexTranscript({ ...params, cursor: 'tail' });
    await appendFile(filePath,
      line('event_msg', { type: 'task_started', turn_id: 'native-turn' })
      + line('event_msg', { type: 'agent_message', message: 'I am done' }, 2)
      + line('event_msg', { type: 'task_complete', turn_id: 'native-turn' }, 3)
      + line('event_msg', { type: 'turn_aborted', turn_id: 'cancelled-turn' }, 4)
      + line('event_msg', { type: 'task_complete' }, 5),
    );
    const result = await readAfterCodexTranscript({ ...params, maxItems: 20, cursor: tail.nextCursor! });
    const facts = result.items.flatMap((item) => item.raw.directSessionObservationV1 ? [item.raw.directSessionObservationV1] : []);
    expect(facts).toEqual([
      { v: 1, source: 'rollout', state: 'running', turnId: 'native-turn' },
      { v: 1, source: 'rollout', state: 'completed', turnId: 'native-turn' },
      { v: 1, source: 'rollout', state: 'cancelled', turnId: 'cancelled-turn' },
      { v: 1, state: 'unknown', reason: 'missing_turn_id' },
    ]);
  });
  it('reads the declared mode from a metadata line larger than the discovery probe window', async () => {
    const { filePath, params } = await createRollout('paginated', {
      base_instructions: { text: 'synthetic instruction '.repeat(4_000) },
    });
    await appendFile(filePath, responseUserLine() + userEventLine('paginated', 'client-large-header'));
    const page = await pageCodexTranscript({ ...params, direction: 'older', maxItems: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.localId).toBe('client-large-header');
  });

  it.each(['legacy', 'paginated'] as const)('pages %s user events once across offsets without matching repeated text', async (mode) => {
    const { filePath, params } = await createRollout(mode);
    const otherMode = mode === 'legacy' ? 'paginated' : 'legacy';
    await appendFile(filePath,
      responseUserLine() + userEventLine(mode, 'client-one', 1)
      // 后续复制的 session_meta 不能改变当前文件首行声明的格式。
      + line('session_meta', { id: 'copied-thread', history_mode: otherMode }, 2)
      + responseUserLine() + userEventLine(mode, 'client-two', 2)
      + responseUserLine() + userEventLine(mode, undefined, 3),
    );

    const full = await pageCodexTranscript({ ...params, direction: 'older', maxItems: 20 });
    expect(full.items).toHaveLength(3);
    expect(full.items.map((item) => item.localId)).toEqual(['client-one', 'client-two', full.items[2]?.id]);
    expect(full.items[0]?.id).not.toBe('client-one');

    const paged: typeof full.items = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = await pageCodexTranscript({ ...params, direction: 'older', cursor });
      paged.unshift(...page.items);
      if (!page.hasMore) break;
      expect(page.nextCursor).toBeTruthy();
      expect(page.nextCursor).not.toBe(cursor);
      cursor = page.nextCursor ?? undefined;
      expect(pageNumber).toBeLessThan(19);
    }
    expect(paged).toEqual(full.items);
  });

  it.each(['legacy', 'paginated'] as const)('follows %s appends without emitting the raw duplicate or consuming an incomplete event', async (mode) => {
    const { filePath, params } = await createRollout(mode);
    const initial = await readAfterCodexTranscript({ ...params, cursor: 'tail' });
    await appendFile(filePath, responseUserLine());
    const rawOnly = await readAfterCodexTranscript({ ...params, cursor: initial.nextCursor! });
    expect(rawOnly.items).toEqual([]);

    const event = userEventLine(mode, 'client-appended');
    await appendFile(filePath, event.slice(0, -1));
    const incomplete = await readAfterCodexTranscript({ ...params, cursor: rawOnly.nextCursor! });
    expect(incomplete.items).toEqual([]);
    await appendFile(filePath, '\n');
    const committed = await readAfterCodexTranscript({ ...params, cursor: incomplete.nextCursor! });
    expect(committed.items).toHaveLength(1);
    expect(committed.items[0]?.localId).toBe('client-appended');
    expect(committed.truncated).toBe(false);
    const idle = await readAfterCodexTranscript({ ...params, cursor: committed.nextCursor! });
    expect(idle.items).toEqual([]);

    const page = await pageCodexTranscript({ ...params, direction: 'older', maxItems: 20 });
    expect(page.items).toEqual(committed.items);
  });

  it.each(['legacy', 'paginated'] as const)('drains %s client IDs across forward page limits', async (mode) => {
    const { filePath, params } = await createRollout(mode);
    const initial = await readAfterCodexTranscript({ ...params, cursor: 'tail' });
    await appendFile(filePath,
      responseUserLine() + userEventLine(mode, 'client-one', 1)
      + responseUserLine() + userEventLine(mode, 'client-two', 2)
      + responseUserLine() + userEventLine(mode, undefined, 3),
    );
    const full = await pageCodexTranscript({ ...params, direction: 'older', maxItems: 20 });
    const followed: typeof full.items = [];
    let cursor = initial.nextCursor!;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page = await readAfterCodexTranscript({ ...params, cursor, maxBytes: 128 });
      followed.push(...page.items);
      if (!page.truncated) break;
      expect(page.truncationReason).toBe('page_limit');
      expect(page.nextCursor).not.toBe(cursor);
      cursor = page.nextCursor!;
      expect(pageNumber).toBeLessThan(19);
    }
    expect(followed.map((item) => item.localId)).toEqual(['client-one', 'client-two', followed[2]?.id]);
    expect(followed).toEqual(full.items);
  });

  it('preserves offset identities when the file does not explicitly declare history_mode', async () => {
    const { filePath, params } = await createRollout();
    await appendFile(filePath, responseUserLine() + userEventLine('legacy', 'unassociated-client'));
    const page = await pageCodexTranscript({ ...params, direction: 'older', maxItems: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.localId).toBe(page.items[0]?.id);
    expect(page.items[0]?.localId).not.toBe('unassociated-client');
  });

  it('requires replacement when resuming a cursor produced by the raw user-message projection', async () => {
    const { filePath, params } = await createRollout('paginated');
    await appendFile(filePath, responseUserLine());
    const initial = await readAfterCodexTranscript({ ...params, cursor: 'tail' });
    const decoded = decodeCodexDirectForwardCursor(initial.nextCursor!);
    if (!decoded || decoded.kind !== 'codexForwardStreamVector' || decoded.v === 4) throw new Error('expected durable cursor');
    // 当前前置实现的 v5 已把 raw 行交给 UI；其后原生事件可以独立追加。
    const previousProjectionCursor = encodeCodexDirectForwardCursor({ ...decoded, v: 5 });
    await appendFile(filePath, userEventLine('paginated', 'client-appended'));
    const changed = await readAfterCodexTranscript({ ...params, cursor: previousProjectionCursor });
    expect(changed.items).toEqual([]);
    expect(changed.truncationReason).toBe('source_discontinuity');

    await appendFile(filePath, responseUserLine() + userEventLine('paginated', 'client-two', 2));
    const latest = await pageCodexTranscript({ ...params, direction: 'older' });
    const older = decodeCodexDirectBackwardCursor(latest.nextCursor ?? undefined);
    if (!older || older.v === 3) throw new Error('expected stream provenance cursor');
    const previousOlderCursor = encodeCodexDirectBackwardCursor({ ...older, v: 4 });
    const replacement = await pageCodexTranscript({ ...params, direction: 'older', cursor: previousOlderCursor });
    expect(replacement.truncationReason).toBe('source_discontinuity');
  });
});
