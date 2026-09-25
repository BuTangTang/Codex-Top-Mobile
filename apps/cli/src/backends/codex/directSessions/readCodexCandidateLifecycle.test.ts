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
    ['unidentified user item cannot resolve pending tool question', start + question('q') + row('response_item', { type: 'message', role: 'user', content: '<subagent_notification>completed</subagent_notification>' })],
    ['ordinary user message cannot resolve two questions before completion', start + question('q1') + question('q2') + event('user_message', { message: 'continue' }) + complete],
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

  it('returns unknown when the file disappears', async () => {
    expect(await readCodexCandidateLifecycle({ filePath, remoteSessionId: 'root', checkedAtMs })).toEqual({ v: 1, state: 'unknown', eventAtMs: null, checkedAtMs });
  });
});
