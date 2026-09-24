import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCodexSessionIndexTitles } from './readCodexSessionIndexTitles';

const ID = '01a0c7cf-6bea-7d50-927b-882a31974396';
/** 使用合成名称构造索引记录，不读取真实会话。 */
function record(title: string, updated = '2026-01-02T00:00:00Z') {
  return JSON.stringify({ id: ID, thread_name: title, updated_at: updated }) + '\n';
}

describe('readCodexSessionIndexTitles', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unmock('node:fs/promises');
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  /** 每个样例使用独立 home，确保同 ID 不会从别的来源借用标题。 */
  async function home(content?: string) {
    const root = await mkdtemp(join(tmpdir(), 'happier-index-title-'));
    roots.push(root);
    if (content !== undefined) await writeFile(join(root, 'session_index.jsonl'), content);
    return root;
  }

  it('selects the greatest valid timestamp rather than the last appended line', async () => {
    const root = await home(record('new') + record('old', '2025-01-01T00:00:00Z'));
    expect((await readCodexSessionIndexTitles(root)).get(ID)).toBe('new');
  });
  it('rejects tied conflicting names until a strictly newer record resolves them', async () => {
    const root = await home(record('one') + record('two') + record('one'));
    expect((await readCodexSessionIndexTitles(root)).has(ID)).toBe(false);
    await writeFile(join(root, 'session_index.jsonl'), record('one') + record('two') + record('resolved', '2026-01-03T00:00:00Z'));
    expect((await readCodexSessionIndexTitles(root)).get(ID)).toBe('resolved');
  });
  it('keeps homes separate and rejects invalid identifiers, dates and empty names', async () => {
    const first = await home(record('first'));
    const second = await home(record('second'));
    expect((await readCodexSessionIndexTitles(first)).get(ID)).toBe('first');
    expect((await readCodexSessionIndexTitles(second)).get(ID)).toBe('second');
    await writeFile(join(second, 'session_index.jsonl'), record('invalid', 'not-a-date') + record('  ') + record('bad').replace(ID, 'not-an-id') + 'broken\n');
    expect((await readCodexSessionIndexTitles(second)).size).toBe(0);
  });
  it('falls back for missing or unreadable indexes and valid JSON without final newline', async () => {
    const root = await home();
    expect((await readCodexSessionIndexTitles(root)).size).toBe(0);
    await mkdir(join(root, 'session_index.jsonl'));
    expect((await readCodexSessionIndexTitles(root)).size).toBe(0);
    await rm(join(root, 'session_index.jsonl'), { recursive: true });
    await writeFile(join(root, 'session_index.jsonl'), record('old') + record('unfinished').trimEnd());
    expect((await readCodexSessionIndexTitles(root)).size).toBe(0);
  });
  it('does not trust an old prefix when the bounded index cannot be consumed completely', async () => {
    const root = await home(record('old') + ' '.repeat(1024 * 1024) + '\n' + record('new', '2026-02-01T00:00:00Z'));
    expect((await readCodexSessionIndexTitles(root)).size).toBe(0);
  });
  it('falls back on EACCES without changing candidate availability', async () => {
    const root = await home(record('unreadable'));
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return { ...actual, stat: vi.fn(async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }) };
    });
    const { readCodexSessionIndexTitles: deniedRead } = await import('./readCodexSessionIndexTitles');
    expect((await deniedRead(root)).size).toBe(0);
  });
});
