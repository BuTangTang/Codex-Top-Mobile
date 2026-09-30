import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { projectDirectTranscriptItems } from '@happier-dev/protocol';
import { readAfterCodexTranscript } from './readAfterCodexTranscript';
import { pageCodexTranscript } from './pageCodexTranscript';

it('reaches text after tool-only records in text projection without an empty network page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-text-page-'));
  const home = join(root, 'codex');
  const remoteSessionId = 'synthetic-text-page';
  const file = join(home, 'sessions', `rollout-2026-01-02T00-00-00-${remoteSessionId}.jsonl`);
  const line = (payload: unknown) => JSON.stringify({ type: 'response_item', timestamp: '2026-01-02T00:00:01.000Z', payload }) + '\n';
  try {
    await mkdir(join(home, 'sessions'), { recursive: true });
    await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: remoteSessionId } }) + '\n');
    const params = { source: { kind: 'codexHome', home: 'user' } as const, env: { CODEX_HOME: home },
      activeServerDir: root, remoteSessionId, maxBytes: 65536, maxItems: 100, scanMaxBytes: 512000, projection: 'conversation_text' as const };
    const start = await readAfterCodexTranscript({ ...params, cursor: 'tail' });
    await appendFile(file,
      line({ type: 'function_call_output', call_id: 'tool1', output: 'x'.repeat(70000) })
      + line({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'retained answer' }] }));
    const result = await readAfterCodexTranscript({ ...params, cursor: start.nextCursor! });
    const visible = projectDirectTranscriptItems(result.items, 'conversation_text');
    expect(result.items).toEqual(visible);
    expect(visible).toHaveLength(1);
    expect(JSON.stringify(visible)).toContain('retained answer');
    expect(result.nextCursor).not.toBe(start.nextCursor);
    const idle = await readAfterCodexTranscript({ ...params, cursor: result.nextCursor! });
    expect(projectDirectTranscriptItems(idle.items, 'conversation_text')).toEqual([]);
    expect(idle.truncated).toBe(false);
    const backward = await pageCodexTranscript({ ...params, direction: 'older' });
    expect(backward.items).toEqual(visible);
    expect(backward.hasMore).toBe(false);
    const legacy = await readAfterCodexTranscript({ ...params, projection: undefined, scanMaxBytes: undefined, cursor: start.nextCursor! });
    expect(legacy.items.length).toBeGreaterThan(0);
    expect(projectDirectTranscriptItems(legacy.items, 'conversation_text')).toEqual([]);
    expect(legacy.truncationReason).toBe('page_limit');
    // Aggregate tools exceeding the scan budget preserve continuation to later text.
    await appendFile(file,
      line({ type: 'function_call_output', call_id: 'tool2', output: 'z'.repeat(300000) })
      + line({ type: 'function_call_output', call_id: 'tool3', output: 'z'.repeat(300000) })
      + line({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'later answer' }] }));
    const bounded = await readAfterCodexTranscript({ ...params, cursor: result.nextCursor! });
    expect(bounded.items).toEqual([]);
    expect(bounded.truncationReason).toBe('page_limit');
    expect(bounded.nextCursor).not.toBe(result.nextCursor);
    const continuation = await readAfterCodexTranscript({ ...params, cursor: bounded.nextCursor! });
    expect(JSON.stringify(continuation.items)).toContain('later answer');

  } finally { await rm(root, { recursive: true, force: true }); }
});
