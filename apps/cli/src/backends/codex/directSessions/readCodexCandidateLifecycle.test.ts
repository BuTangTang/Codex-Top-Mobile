import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCodexCandidateLifecycle } from './readCodexCandidateLifecycle';

const checkedAtMs = Date.parse('2026-09-24T08:00:00Z');
const at = checkedAtMs - 1000;
const row = (type: string, payload: Record<string, unknown>, timestamp: unknown = new Date(at).toISOString()) => JSON.stringify({ type, timestamp, payload }) + '\n';
const event = (type: string, extra: Record<string, unknown> = {}, timestamp?: unknown) => row('event_msg', { type, ...extra }, timestamp);
const start = event('task_started', { turn_id: 'turn' });
const complete = event('task_complete', { turn_id: 'turn' });
const question = (callId: string, name = 'request_user_input') => row('response_item', { type: 'function_call', name, call_id: callId, arguments: '{"questions":[{"id":"choice"}]}' });
const answer = (callId: string) => row('response_item', { type: 'function_call_output', call_id: callId, output: '{"answers":{"choice":{"answers":["yes"]}}}' });

describe('readCodexCandidateLifecycle', () => {
  let directory: string;
  let filePath: string;
  beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), 'codex-lifecycle-')); filePath = join(directory, 'rollout.jsonl'); });
  afterEach(async () => { vi.restoreAllMocks(); vi.doUnmock('node:fs/promises'); vi.resetModules(); await fs.rm(directory, { recursive: true, force: true }); });
  async function read(body: string, meta: Record<string, unknown> = { id: 'root', source: 'cli' }) {
    await fs.writeFile(filePath, row('session_meta', meta) + body);
    return readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs });
  }

  it.each([
    ['start', start, 'running'],
    ['complete', start + complete, 'completed'],
    ['terminal is an explicit tail anchor without start', complete, 'completed'],
    ['failed without start', event('task_failed', { turn_id: 'turn' }), 'failed'],
    ['cancelled without start', event('turn_aborted', { turn_id: 'turn' }), 'cancelled'],
    ['tail request still outlives orphan completion', question('q', 'request_user_input_async') + complete, 'needs_input'],
    ['failed', start + event('task_failed', { turn_id: 'turn' }), 'failed'],
    ['cancelled', start + event('turn_aborted', { turn_id: 'turn' }), 'cancelled'],
    ['approval', start + event('exec_approval_request', { call_id: 'approval' }), 'needs_input'],
    ['async question outlives turn completion', start + question('q', 'request_user_input_async') + complete, 'needs_input'],
    ['async acknowledgement is not an answer', start + question('q', 'request_user_input_async') + answer('q') + complete, 'needs_input'],
    ['unrelated tool result preserves question', start + question('q') + answer('other'), 'needs_input'],
    ['all questions must resolve', start + question('q1') + question('q2') + answer('q1'), 'needs_input'],
    ['unidentified user item cannot resolve pending tool question', start + question('q') + row('response_item', { type: 'message', role: 'user', content: '<subagent_notification>completed</subagent_notification>' }), 'needs_input'],
    ['ordinary user message cannot resolve two questions before completion', start + question('q1') + question('q2') + event('user_message', { message: 'continue' }) + complete, 'needs_input'],
    ['matching result resolves question', start + question('q') + answer('q'), 'running'],
    ['matching approval resolves', start + event('exec_approval_request', { call_id: 'a' }) + event('approval_resolved', { call_id: 'a' }), 'running'],
    ['new turn clears old question', start + question('q') + event('task_started', { turn_id: 'new' }), 'running'],
    ['old turn terminal does not finish current', event('task_started', { turn_id: 'old' }) + start + event('task_complete', { turn_id: 'old' }), 'running'],
    ['child terminal does not finish parent', start + event('task_complete', { turn_id: 'turn', thread_id: 'child' }), 'running'],
    ['tool error is not task failure', start + row('response_item', { type: 'function_call_output', call_id: 'tool', is_error: true, output: 'failed' }), 'running'],
    ['body cannot imply completion', start + row('response_item', { type: 'message', role: 'assistant', content: [{ text: 'task_complete' }] }), 'running'],
  ])('%s', async (_name, body, state) => {
    expect(await read(body)).toEqual({ v: 1, state, eventAtMs: at, checkedAtMs });
  });

  it.each([
    ['orphan terminal without ID', event('task_complete')],
    ['orphan terminal followed by a conflicting turn', complete + event('task_complete', { turn_id: 'other' })],
    ['orphan terminal conflicts with preceding explicit activity turn', event('agent_message', { turn_id: 'other', message: 'not inspected' }) + complete],
    ['orphan terminal followed by incomplete turn context', complete + row('turn_context', {})],
    ['orphan terminal followed by new context', complete + row('turn_context', { turn_id: 'new' })],
    ['orphan terminal after invalid record', 'not-json\n' + complete],
    ['missing turn ID', event('task_started')],
    ['missing terminal ID', start + event('task_complete')],
    ['malformed tail', start + complete + '{"type":'],
    ['valid but unterminated tail', start + complete.trimEnd()],
    ['invalid middle record', start + 'not-json\n' + complete],
    ['missing timestamp', event('task_started', { turn_id: 'turn' }, null)],
    ['invalid timestamp', event('task_started', { turn_id: 'turn' }, 'bad')],
    ['future timestamp', event('task_started', { turn_id: 'turn' }, new Date(checkedAtMs + 1).toISOString())],
    ['stale running', event('task_started', { turn_id: 'turn' }, new Date(checkedAtMs - 900_001).toISOString())],
    ['new turn context without start', start + complete + row('turn_context', { turn_id: 'new' })],
    ['new input without next turn anchor', start + complete + row('response_item', { type: 'message', role: 'user', content: [] })],
    ['unseen terminal cannot be attributed to an old turn', start + event('task_complete', { turn_id: 'unseen' })],
    ['tool error does not answer a question', start + question('q') + row('response_item', { type: 'function_call_output', call_id: 'q', is_error: true, output: 'failed' }) + complete],
    ['natural language tool output does not answer a question', start + question('q') + row('response_item', { type: 'function_call_output', call_id: 'q', output: 'user said yes' }) + complete],
    ['partial structured answers do not resolve the whole request', start + row('response_item', { type: 'function_call', name: 'request_user_input', call_id: 'q', arguments: '{"questions":[{"id":"choice"},{"id":"missing"}]}' }) + answer('q') + complete],
    ['input resolution cannot approve a command request', start + event('exec_approval_request', { call_id: 'approval' }) + event('user_input', { call_id: 'approval' }) + complete],
  ])('returns explicit unknown for %s', async (_name, body) => {
    expect(await read(body)).toEqual({ v: 1, state: 'unknown', eventAtMs: null, checkedAtMs });
  });

  it('rejects conflicting identity and subagent sources', async () => {
    for (const meta of [{ id: 'other' }, { id: 'root', source: { subagent: {} } }]) {
      expect((await read(start + complete, meta)).state).toBe('unknown');
    }
  });

  it('does not use mtime for running freshness or completion time', async () => {
    const result = await read(start + complete);
    await fs.utimes(filePath, 1, 1);
    expect(await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).toEqual(result);
  });

  it('bounds large histories and accepts an explicit terminal when start is outside the tail window', async () => {
    const large = row('response_item', { type: 'message', role: 'assistant', content: 'x'.repeat(200_000) });
    expect((await read(start + large + complete)).state).toBe('completed');
    expect((await read(large + start + complete)).state).toBe('completed');
  });

  it.each(['not-json\n', 'null\n'])('rejects a complete invalid line after the truncated large-line prefix (%s)', async (invalid) => {
    const large = row('response_item', { type: 'message', role: 'assistant', content: 'x'.repeat(200_000) });
    expect((await read(start + large + invalid + complete)).state).toBe('unknown');
  });

  it.each([false, true])('rechecks one append but rejects continuing writes (continuous=%s)', async (continuous) => {
    await read(start + complete);
    let reads = 0;
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return { ...actual, lstat: async (path: Parameters<typeof actual.lstat>[0]) => {
        if (++reads === 2 || (continuous && reads === 4)) await actual.appendFile(filePath, event('task_started', { turn_id: reads === 2 ? 'new' : 'newer' }));
        return actual.lstat(path);
      } };
    });
    const { readCodexCandidateLifecycle: readDuringChange } = await import('./readCodexCandidateLifecycle');
    expect((await readDuringChange({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe(continuous ? 'unknown' : 'running');
    expect(reads).toBe(4);
  });

  it.each(['rewrite', 'truncate', 'replace', 'identity-growth'] as const)('rejects %s while reading without reusing old completion', async (kind) => {
    await read(start + complete);
    let reads = 0;
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return { ...actual, lstat: async (path: Parameters<typeof actual.lstat>[0]) => {
        if (++reads === 2) {
          if (kind === 'replace') {
            await actual.rename(filePath, filePath + '.old');
            await actual.writeFile(filePath, row('session_meta', { id: 'root', source: 'cli' }) + start + complete);
          } else if (kind === 'truncate') await actual.writeFile(filePath, row('session_meta', { id: 'root' }));
          else if (kind === 'identity-growth') await actual.writeFile(filePath,
            row('session_meta', { id: 'other', source: 'cli' }) + start + complete + event('task_started', { turn_id: 'new' }));
          else {
            await actual.writeFile(filePath, row('session_meta', { id: 'root', source: 'cli' }) + start + complete);
            await actual.utimes(filePath, 1, 1);
          }
        }
        return actual.lstat(path);
      } };
    });
    const { readCodexCandidateLifecycle: readDuringChange } = await import('./readCodexCandidateLifecycle');
    expect((await readDuringChange({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('unknown');
    expect(reads).toBe(kind === 'identity-growth' ? 3 : 2);
  });

  it('rejects a source replacement between the append and retry', async () => {
    await read(start + complete);
    let reads = 0;
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return { ...actual, lstat: async (path: Parameters<typeof actual.lstat>[0]) => {
        reads++;
        if (reads === 2) await actual.appendFile(filePath, event('task_started', { turn_id: 'new' }));
        if (reads === 3) {
          await actual.rename(filePath, filePath + '.old');
          await actual.writeFile(filePath, row('session_meta', { id: 'root' }) + start + complete);
        }
        return actual.lstat(path);
      } };
    });
    const { readCodexCandidateLifecycle: readDuringChange } = await import('./readCodexCandidateLifecycle');
    expect((await readDuringChange({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('unknown');
  });

  it('recovers at an explicit new start after an unknown prefix terminal', async () => {
    const prefix = row('turn_context', { turn_id: 'old' }) + event('task_complete', { turn_id: 'old' });
    expect((await read(prefix + start + complete)).state).toBe('completed');
    expect((await read(prefix)).state).toBe('unknown');
  });

  it('does not let structured old subagent activity revoke the latest main completion', async () => {
    const late = event('item_completed', { turn_id: 'old', thread_id: 'root', item: { type: 'SubAgentActivity' } });
    expect((await read(start + complete + late)).state).toBe('completed');
    const main = event('item_completed', { turn_id: 'unseen', thread_id: 'root', item: { type: 'AgentMessage' } });
    expect((await read(start + complete + main)).state).toBe('unknown');
  });

  it('returns unknown when the file disappears', async () => {
    expect(await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).toEqual({ v: 1, state: 'unknown', eventAtMs: null, checkedAtMs });
  });

  /** 构造无状态含义的完整正文行，验证开始证据超出尾窗后的连续读取。 */
  function filler(bytes = 8000): string {
    return row('response_item', { type: 'message', role: 'assistant', content: 'x'.repeat(bytes) });
  }

  /** 用有界的多次列表刷新推进冷恢复，不从正文或次数猜状态。 */
  async function recover(maxCalls = 20): Promise<Awaited<ReturnType<typeof readCodexCandidateLifecycle>>> {
    let result = await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs });
    for (let call = 1; result.state === 'unknown' && call < maxCalls; call++) {
      result = await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs });
    }
    return result;
  }

  /** 证明冷启动可恢复尾窗之外的真实开始。 */
  it('recovers an explicit start beyond 600 KiB without rereading the whole history', async () => {
    await fs.writeFile(filePath, row('session_meta', { id: 'root' }) + filler().repeat(200) + start
      + row('turn_context', { turn_id: 'turn' }) + filler().repeat(80));
    expect((await recover()).state).toBe('running');
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('running');
  });

  /** 证明持续追加不会淘汰本轮开始证据。 */
  it('retains the explicit start across repeated appends beyond the tail window', async () => {
    expect((await read(start)).state).toBe('running');
    for (let index = 0; index < 12; index++) {
      await fs.appendFile(filePath, filler().repeat(12));
      expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('running');
    }
    await fs.appendFile(filePath, complete);
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('completed');
  });

  /** 证明追赶新增记录期间不会发布旧完成。 */
  it('catches up the new turn before publishing a cached completion', async () => {
    expect((await read(start + complete)).state).toBe('completed');
    await fs.appendFile(filePath, filler().repeat(90) + event('task_started', { turn_id: 'new' }));
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('running');
    expect((await recover()).state).toBe('running');
  });

  /** 证明冷搜索及前向重放可跨刷新推进。 */
  it('completes ordinary long-history recovery in one refresh', async () => {
    await fs.writeFile(filePath, row('session_meta', { id: 'root' }) + start + filler().repeat(450));
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('running');
    expect((await recover(40)).state).toBe('running');
  });

  /** 证明恢复路径不能跨越坏行构造运行。 */
  it('cannot skip invalid JSON while replaying recovered history', async () => {
    await fs.writeFile(filePath, row('session_meta', { id: 'root' }) + start + 'not-json\n' + filler().repeat(90));
    for (let index = 0; index < 8; index++) {
      expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('unknown');
    }
  });

  /** 证明超长完整行与未闭合尾行的行为不同。 */
  it('replays a large complete line but never exposes a partial EOF as current state', async () => {
    expect((await read(start)).state).toBe('running');
    await fs.appendFile(filePath, filler(600_000).slice(0, -1));
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('unknown');
    await fs.appendFile(filePath, '\n' + complete);
    expect((await recover()).state).toBe('completed');
  });

  /** 证明来源代次变化后不能借用旧状态。 */
  it.each(['replace', 'truncate', 'rewrite'] as const)('invalidates cached evidence after %s', async (kind) => {
    expect((await read(start)).state).toBe('running');
    if (kind === 'replace') await fs.rename(filePath, filePath + '.old');
    await fs.writeFile(filePath, row('session_meta', { id: 'root' }) + (kind === 'truncate' ? '' : filler()));
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('unknown');
  });

  /** 证明白名单结构化同轮活动可刷新运行时间。 */
  it.each(['AgentMessage', 'Reasoning', 'CommandExecution', 'FileChange', 'McpToolCall', 'DynamicToolCall', 'WebSearch'])('refreshes an anchored current turn using structured %s activity', async (type) => {
    const old = event('task_started', { turn_id: 'turn' }, new Date(checkedAtMs - 900_001).toISOString());
    expect((await read(old + event('item_completed', { turn_id: 'turn', item: { type } }))).state).toBe('running');
  });

  it.each([
    { turn_id: 'turn', item: { type: 'SubAgentActivity' } },
    { turn_id: 'turn', thread_id: 'child', item: { type: 'AgentMessage' } },
    { turn_id: 'turn', sidechain_id: 'child', item: { type: 'AgentMessage' } },
    { item: { type: 'AgentMessage' } },
  ])('rejects unscoped or child freshness (%j)', async (activity) => {
    const old = event('task_started', { turn_id: 'turn' }, new Date(checkedAtMs - 900_001).toISOString());
    expect((await read(old + event('item_completed', activity))).state).toBe('unknown');
  });

  /** 证明晚到的同轮活动不会重启已完成轮。 */
  it('never reopens completed state from modern same-turn activity', async () => {
    expect((await read(start + complete + event('item_completed', { turn_id: 'turn', item: { type: 'AgentMessage' } }))).state).toBe('completed');
  });

  /** 证明缓存不会用刷新时间延长运行证据。 */
  it('rechecks cached running freshness without borrowing the file time', async () => {
    expect((await read(start)).state).toBe('running');
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs: checkedAtMs + 900_001 })).state).toBe('unknown');
  });

  /** 证明同源并发有界且不会相互覆盖状态。 */
  it('bounds concurrent same-source reads and lets the first read finish', async () => {
    await fs.writeFile(filePath, row('session_meta', { id: 'root' }) + start);
    const first = readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs });
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('unknown');
    expect((await first).state).toBe('running');
  });


  /** 证明追加过程中改写远端开始锚会被检测。 */
  it('invalidates a recovered start when it is rewritten together with an append', async () => {
    const prefix = row('session_meta', { id: 'root' }) + filler().repeat(200);
    await fs.writeFile(filePath, prefix + start + row('turn_context', { turn_id: 'turn' }) + filler().repeat(90));
    expect((await recover()).state).toBe('running');
    const file = await fs.open(filePath, 'r+');
    try { await file.write(event('task_started', { turn_id: 'fake' }), Buffer.byteLength(prefix)); }
    finally { await file.close(); }
    await fs.appendFile(filePath, filler());
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('unknown');
  });


  /** 用真实文件读取计量总预算，并验证冷恢复完成后的普通刷新只读取校验边界。 */
  it('enforces 64 MiB total IO and keeps routine validation below 96 KiB', async () => {
    await fs.writeFile(filePath, row('session_meta', { id: 'root' }) + filler().repeat(150) + start + filler().repeat(450));
    let readBytes = 0;
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
        const file = await actual.open(...args);
        return new Proxy(file, { get(target, property) {
          if (property === 'read') return async (...readArgs: unknown[]) => {
            const result = await Reflect.apply(target.read, target, readArgs);
            readBytes += result.bytesRead;
            return result;
          };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      } };
    });
    const { readCodexCandidateLifecycle: meteredRead } = await import('./readCodexCandidateLifecycle');
    let state = 'unknown';
    for (let call = 0; state === 'unknown' && call < 40; call++) {
      readBytes = 0;
      state = (await meteredRead({ filePath, remoteSessionId: 'root', checkedAtMs })).state;
      expect(readBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    }
    expect(state).toBe('running');
    readBytes = 0;
    expect((await meteredRead({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('running');
    expect(readBytes).toBeLessThanOrEqual(96 * 1024);
    // 冷恢复累计只搜索最近 32 MiB；预算外的旧开始不触发整文件遍历，新终止仍可由尾窗恢复。
    await fs.writeFile(filePath, row('session_meta', { id: 'root' }) + start + filler().repeat(4400));
    for (let call = 0; call < 24; call++) {
      readBytes = 0;
      expect((await meteredRead({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('unknown');
      expect(readBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    }
    expect(readBytes).toBeLessThanOrEqual(96 * 1024);
    await fs.appendFile(filePath, complete);
    expect((await meteredRead({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('completed');
  });

  /** 缓存达到上限时淘汰最久未用来源；被淘汰的大历史再次读取必须重新证明运行。 */
  it('keeps correct states after visiting more sources than the cache limit', async () => {
    await fs.writeFile(filePath, row('session_meta', { id: 'root' }) + start + filler().repeat(90));
    expect((await recover()).state).toBe('running');
    for (let index = 0; index < 129; index++) {
      const other = join(directory, `source-${index}.jsonl`);
      await fs.writeFile(other, row('session_meta', { id: 'root' }) + start);
      expect((await readCodexCandidateLifecycle({ filePath: other, remoteSessionId: 'root', checkedAtMs })).state).toBe('running');
    }
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('running');
  });

  /** 拒绝超长待处理标识，且超长子线程 ID 仍被识别为子来源。 */
  it('bounds cached metadata without promoting malformed child identity to main thread', async () => {
    expect((await read(start + question('q'.repeat(600)))).state).toBe('unknown');
    expect((await read(start + event('task_complete', { turn_id: 'turn', thread_id: 'child'.repeat(200) }))).state).toBe('running');
  });


  /** 正常截图产生十余 MiB 单行时，首次同步应完整重放，不能永久未知。 */
  it.each([12, 16])('recovers a %i MiB image-style line in at most two normal reads', async (imageMiB) => {
    const image = row('response_item', { type: 'message', role: 'user', content: [
      { type: 'input_image', image_url: 'data:image/png;base64,' + 'a'.repeat(imageMiB * 1024 * 1024) },
    ] });
    await fs.writeFile(filePath, row('session_meta', { id: 'root' }) + start + image
      + event('item_completed', { turn_id: 'turn', item: { type: 'AgentMessage' } }));
    const began = performance.now();
    expect((await recover(2)).state).toBe('running');
    console.info(JSON.stringify({ sample: 'image-lifecycle-recovery', imageMiB, elapsedMs: Math.round(performance.now() - began) }));
    await fs.appendFile(filePath, complete);
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('completed');
    await fs.appendFile(filePath, event('task_started', { turn_id: 'new' }) + image
      + event('item_completed', { turn_id: 'new', item: { type: 'AgentMessage' } }));
    expect((await recover(2)).state).toBe('running');
  });

  /** 已复现的中段终态被改写并追加时，缓存必须重新验证终态证据。 */
  it('does not reuse a rewritten middle terminal after an append', async () => {
    const prefix = row('session_meta', { id: 'root' }) + start + filler(12_000);
    await fs.writeFile(filePath, prefix + complete + filler(12_000));
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('completed');
    const file = await fs.open(filePath, 'r+');
    try { await file.write(event('task_complete', { turn_id: 'fake' }), Buffer.byteLength(prefix)); }
    finally { await file.close(); }
    await fs.appendFile(filePath, filler());
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('unknown');
  });


  /** 运行中的普通追加输入不能丢弃轮锚，也不能自行证明待处理问题已经回答。 */
  it('preserves the anchored wait when raw user input arrives', async () => {
    expect((await read(start + question('q', 'request_user_input_async')
      + row('response_item', { type: 'message', role: 'user', content: [] }))).state).toBe('needs_input');
  });

  /** 精确复现原生追加输入事件：桌面同任务同轮接受输入后继续执行，后续活动应可续龄。 */
  it('resumes an input wait after raw user, same-turn native UserMessage and modern activity', async () => {
    const nativeUser = event('item_completed', { thread_id: 'root', turn_id: 'turn', item: { type: 'UserMessage' } });
    const activity = event('item_completed', { thread_id: 'root', turn_id: 'turn', item: { type: 'Reasoning' } });
    expect((await read(start + question('q', 'request_user_input_async')
      + row('response_item', { type: 'message', role: 'user', content: [] }) + nativeUser + activity)).state).toBe('running');
  });

  /** 同轮用户输入只结束普通输入等待，执行审批必须继续等待明确批准结果。 */
  it('keeps approval pending after same-turn native UserMessage', async () => {
    const nativeUser = event('item_completed', { thread_id: 'root', turn_id: 'turn', item: { type: 'UserMessage' } });
    const body = start + question('q') + event('exec_approval_request', { call_id: 'approval' })
      + row('response_item', { type: 'message', role: 'user', content: [] }) + nativeUser;
    expect((await read(body)).state).toBe('needs_input');
    await fs.appendFile(filePath, event('approval_resolved', { call_id: 'approval' }));
    expect((await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).state).toBe('running');
  });

  /** 已结束轮的输入不是新轮开始；异轮用户事件也不能续跑旧完成或批准命令。 */
  it.each(['turn', 'other'])('does not revive a terminal turn from native UserMessage (%s)', async (turn_id) => {
    const nativeUser = event('item_completed', { thread_id: 'root', turn_id, item: { type: 'UserMessage' } });
    expect((await read(start + complete + nativeUser)).state).toBe('unknown');
  });

  /** 缺少可信任务或轮标识的用户事件保留等待，不能当成桌面的继续确认。 */
  it.each([
    { turn_id: 'turn', item: { type: 'UserMessage' } },
    { thread_id: 'root', item: { type: 'UserMessage' } },
    { thread_id: 'child', turn_id: 'turn', item: { type: 'UserMessage' } },
  ])('does not resolve a wait with an unscoped or foreign native UserMessage (%j)', async (nativeUser) => {
    expect((await read(start + question('q') + event('item_completed', nativeUser))).state).toBe('needs_input');
  });

  /** 异轮用户事件不能被解释为当前执行审批的批准。 */
  it('does not resolve approval using another turn UserMessage', async () => {
    expect((await read(start + event('exec_approval_request', { call_id: 'approval' })
      + event('item_completed', { thread_id: 'root', turn_id: 'other', item: { type: 'UserMessage' } }))).state).toBe('unknown');
  });

});
