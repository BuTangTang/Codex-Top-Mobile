import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DirectSessionAttachmentV1, DirectTranscriptRawMessageV1 } from '@happier-dev/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configuration, reloadConfiguration } from '@/configuration';
import { pageCodexRolloutStreams, readAfterCodexRolloutStreams } from './codexDirectTranscriptStreamPaging';

const sessionId = '11111111-1111-1111-1111-111111111111';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2S0AAAAASUVORK5CYII=', 'base64');

/** 合成原生图片生成事件，只向本测试临时历史写入。 */
function generatedLine(data: Buffer, id = 'image-one'): string {
  return JSON.stringify({ type: 'response_item', timestamp: '2026-01-02T00:00:02.000Z',
    payload: { type: 'image_generation_call', id, status: 'completed', result: data.toString('base64') } }) + '\n';
}

/** 从实际分页输出提取附件，测试不旁路投影层。 */
function attachments(items: readonly DirectTranscriptRawMessageV1[]): DirectSessionAttachmentV1[] {
  return items.flatMap((item) => {
    const raw = item.raw as { meta?: { happier?: { payload?: { attachments?: DirectSessionAttachmentV1[] } } } };
    return raw.meta?.happier?.payload?.attachments ?? [];
  });
}

describe('Codex direct generated image paging', () => {
  let root: string;
  let codexHome: string;
  let rollout: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happier-direct-image-paging-'));
    vi.stubEnv('HAPPIER_HOME_DIR', join(root, 'happier'));
    reloadConfiguration();
    codexHome = join(root, 'codex-home');
    const sessions = join(codexHome, 'sessions');
    await mkdir(sessions, { recursive: true });
    rollout = join(sessions, `rollout-2026-01-02T00-00-00-${sessionId}.jsonl`);
    await appendFile(rollout, JSON.stringify({ type: 'session_meta', payload: { id: sessionId, timestamp: '2026-01-02T00:00:00.000Z', cwd: join(root, 'project') } }) + '\n');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    reloadConfiguration();
    await rm(root, { recursive: true, force: true });
  });

  it('materializes identical image bytes for live and historical reads without inline base64 or source writes', async () => {
    const base = { codexHome, remoteSessionId: sessionId, maxBytes: 4096, maxItems: 10, projection: 'conversation_text' as const };
    const tail = await readAfterCodexRolloutStreams({ ...base, cursor: 'tail' });
    await appendFile(rollout, generatedLine(png));
    const original = await readFile(rollout);
    const live = await readAfterCodexRolloutStreams({ ...base, cursor: tail.nextCursor! });
    const history = await pageCodexRolloutStreams({ ...base, direction: 'older' });
    const image = attachments(live.items)[0];
    expect(image).toMatchObject({ kind: 'image', mimeType: 'image/png', sizeBytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex') });
    expect(image?.availability).toBeUndefined();
    expect(image?.path).toEqual(expect.stringContaining(join(configuration.activeServerDir, 'direct-generated-media')));
    expect(await readFile(image!.path!)).toEqual(png);
    expect(attachments(history.items)).toEqual([image]);
    expect(JSON.stringify(live)).not.toContain(png.toString('base64'));
    expect(await readFile(rollout)).toEqual(original);
    expect(await readdir(join(configuration.activeServerDir, 'direct-generated-media'))).toHaveLength(1);
    expect(await readdir(root)).not.toContain('project');
  });

  it('advances beyond a generated image above the old 8 MiB line budget in both paging directions', async () => {
    const base = { codexHome, remoteSessionId: sessionId, maxBytes: 4096, maxItems: 10, projection: 'conversation_text' as const };
    const tail = await readAfterCodexRolloutStreams({ ...base, cursor: 'tail' });
    const largeImage = Buffer.alloc(7 * 1024 * 1024);
    png.copy(largeImage);
    const line = generatedLine(largeImage, 'large-image');
    expect(Buffer.byteLength(line)).toBeGreaterThan(8 * 1024 * 1024);
    await appendFile(rollout, line + JSON.stringify({ type: 'response_item', timestamp: '2026-01-02T00:00:03.000Z',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'after image' }] } }) + '\n');
    const first = await readAfterCodexRolloutStreams({ ...base, cursor: tail.nextCursor! });
    const second = await readAfterCodexRolloutStreams({ ...base, cursor: first.nextCursor! });
    expect(attachments(first.items)[0]).toMatchObject({ sizeBytes: largeImage.length });
    expect(attachments(first.items)[0]?.availability).toBeUndefined();
    expect(JSON.stringify([...first.items, ...second.items])).toContain('after image');
    expect((await readAfterCodexRolloutStreams({ ...base, cursor: second.nextCursor! })).items).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(4096);
    expect((await readFile(attachments(first.items)[0]!.path!)).equals(largeImage)).toBe(true);
    const recent = await pageCodexRolloutStreams({ ...base, direction: 'older' });
    expect(JSON.stringify(recent.items)).toContain('after image');
    const earlier = await pageCodexRolloutStreams({ ...base, direction: 'older', cursor: recent.nextCursor! });
    expect(attachments(earlier.items)).toEqual(attachments(first.items));
  });

  it('reports materialization failure while advancing to later messages', async () => {
    const base = { codexHome, remoteSessionId: sessionId, maxBytes: 4096, maxItems: 10, projection: 'conversation_text' as const };
    const tail = await readAfterCodexRolloutStreams({ ...base, cursor: 'tail' });
    await mkdir(configuration.activeServerDir, { recursive: true });
    await writeFile(join(configuration.activeServerDir, 'direct-generated-media'), 'not a directory');
    await appendFile(rollout, generatedLine(png) + JSON.stringify({ type: 'response_item', timestamp: '2026-01-02T00:00:03.000Z',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'still available' }] } }) + '\n');
    const result = await readAfterCodexRolloutStreams({ ...base, cursor: tail.nextCursor! });
    expect(attachments(result.items)).toEqual([{ name: '生成图片', kind: 'image', availability: 'unavailable', reason: 'materialization_failed' }]);
    expect(JSON.stringify(result.items)).toContain('still available');
    expect((await readAfterCodexRolloutStreams({ ...base, cursor: result.nextCursor! })).items).toEqual([]);
  });

  it('does not materialize sidechain images excluded by the mobile conversation projection', async () => {
    const childId = '22222222-2222-2222-2222-222222222222';
    await appendFile(rollout, JSON.stringify({ type: 'event_msg', timestamp: '2026-01-02T00:00:01.000Z',
      payload: { type: 'collab_agent_spawn_end', sender_thread_id: sessionId, new_thread_id: childId, prompt: 'synthetic child' } }) + '\n');
    await writeFile(join(codexHome, 'sessions', `rollout-2026-01-02T00-00-01-${childId}.jsonl`), generatedLine(png));
    const base = { codexHome, remoteSessionId: sessionId, direction: 'older' as const, maxBytes: 4096, maxItems: 10 };
    expect(attachments((await pageCodexRolloutStreams({ ...base, projection: 'conversation_text' })).items)).toEqual([]);
    await expect(readdir(join(configuration.activeServerDir, 'direct-generated-media'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(attachments((await pageCodexRolloutStreams(base)).items)[0]).toMatchObject({ kind: 'image', sizeBytes: png.length });
  });
});
