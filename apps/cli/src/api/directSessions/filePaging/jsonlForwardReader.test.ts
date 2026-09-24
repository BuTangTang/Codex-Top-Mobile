import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { readJsonlFileForward } from './jsonlForwardReader';

function buildJsonl(lines: unknown[], opts?: { trailingNewline?: boolean }): string {
  const trailingNewline = opts?.trailingNewline !== false;
  const joined = lines.map((line) => JSON.stringify(line)).join('\n');
  return trailingNewline ? `${joined}\n` : joined;
}

describe('readJsonlFileForward', () => {
  it('reports missing files in strict reads while preserving legacy default behavior', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-jsonl-missing-'));
    const params = { filePath: join(root, 'missing.jsonl'), offsetBytes: 0, maxBytes: 1024, maxItems: 2 };
    await expect(readJsonlFileForward(params)).resolves.toMatchObject({ items: [], reachedEnd: true });
    await expect(readJsonlFileForward({ ...params, strictRead: true })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads forward from an offset and advances the cursor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-forward-'));
    const filePath = join(dir, 't.jsonl');
    await writeFile(filePath, buildJsonl([{ i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }, { i: 5 }]), 'utf8');

    const page1 = await readJsonlFileForward({ filePath, offsetBytes: 0, maxBytes: 1024, maxItems: 2 });
    expect(page1.items.map((x) => (x.value as any).i)).toEqual([1, 2]);
    expect(page1.truncated).toBe(false);
    expect(page1.hitPageLimit).toBe(true);

    const page2 = await readJsonlFileForward({ filePath, offsetBytes: page1.nextOffsetBytes, maxBytes: 1024, maxItems: 2 });
    expect(page2.items.map((x) => (x.value as any).i)).toEqual([3, 4]);

    const page3 = await readJsonlFileForward({ filePath, offsetBytes: page2.nextOffsetBytes, maxBytes: 1024, maxItems: 10 });
    expect(page3.items.map((x) => (x.value as any).i)).toEqual([5]);
    expect(page3.reachedEnd).toBe(true);
    expect(page3.hitPageLimit).toBe(false);
  });

  it('distinguishes a byte-limited page from an incomplete line at EOF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-forward-'));
    const filePath = join(dir, 't.jsonl');
    const firstLine = buildJsonl([{ i: 1 }]);
    const partialLine = JSON.stringify({ i: 2 }).slice(0, -1);
    await writeFile(filePath, firstLine + partialLine, 'utf8');

    const limited = await readJsonlFileForward({ filePath, offsetBytes: 0, maxBytes: Buffer.byteLength(firstLine), maxItems: 10 });
    expect(limited.items.map((line) => line.value)).toEqual([{ i: 1 }]);
    expect(limited.hitPageLimit).toBe(true);

    const partial = await readJsonlFileForward({ filePath, offsetBytes: limited.nextOffsetBytes, maxBytes: 1024, maxItems: 10 });
    expect(partial.items).toEqual([]);
    expect(partial.reachedEnd).toBe(false);
    expect(partial.hitPageLimit).toBe(false);
    expect(partial.nextOffsetBytes).toBe(limited.nextOffsetBytes);
  });

  it('parses a final line without a terminal newline when it is valid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-forward-'));
    const filePath = join(dir, 't.jsonl');
    await writeFile(filePath, buildJsonl([{ i: 1 }, { i: 2 }], { trailingNewline: false }), 'utf8');

    const page = await readJsonlFileForward({ filePath, offsetBytes: 0, maxBytes: 1024, maxItems: 10 });
    expect(page.items.map((x) => (x.value as any).i)).toEqual([1, 2]);
    expect(page.nextOffsetBytes).toBeGreaterThan(0);
  });

  it('reports truncation when the file shrinks behind the cursor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-forward-'));
    const filePath = join(dir, 't.jsonl');
    await writeFile(filePath, buildJsonl([{ i: 1 }, { i: 2 }]), 'utf8');

    const first = await readJsonlFileForward({ filePath, offsetBytes: 0, maxBytes: 1024, maxItems: 10 });
    expect(first.truncated).toBe(false);

    // Truncate file.
    await writeFile(filePath, '', 'utf8');

    const after = await readJsonlFileForward({ filePath, offsetBytes: first.nextOffsetBytes, maxBytes: 1024, maxItems: 10 });
    expect(after.truncated).toBe(true);
    expect(after.items).toEqual([]);
    expect(after.nextOffsetBytes).toBe(0);
  });

  it('advances past an oversized first line instead of stalling at the same offset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-forward-'));
    const filePath = join(dir, 't.jsonl');
    const oversized = { kind: 'image', data: 'x'.repeat(300_000) };
    await writeFile(filePath, buildJsonl([oversized, { i: 2 }]), 'utf8');

    const page1 = await readJsonlFileForward({ filePath, offsetBytes: 0, maxBytes: 1024, maxItems: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextOffsetBytes).toBeGreaterThan(0);

    const page2 = await readJsonlFileForward({ filePath, offsetBytes: page1.nextOffsetBytes, maxBytes: 1024, maxItems: 10 });
    expect(page2.items.map((x) => (x.value as any).i)).toEqual([2]);
  });

  it('advances across complete malformed rows even when no item is returned', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-forward-'));
    const filePath = join(dir, 't.jsonl');
    const malformed = `not-json-${'x'.repeat(1500)}\n`;
    await writeFile(filePath, malformed, 'utf8');

    const page = await readJsonlFileForward({ filePath, offsetBytes: 0, maxBytes: 1024, maxItems: 1 });
    expect(page.items).toEqual([]);
    expect(page.nextOffsetBytes).toBe(Buffer.byteLength(malformed));
    expect(page.reachedEnd).toBe(true);
  });
  it('bounds cumulative buffer assembly for a complete oversized line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-linear-'));
    const filePath = join(dir, 'synthetic.jsonl');
    const value = { text: '中文'.repeat(180_000) };
    const source = buildJsonl([value]);
    await writeFile(filePath, source);
    // 在真实分配边界量累计复制字节，避免脆弱的耗时断言和内部调用次数断言。
    const concat = vi.spyOn(Buffer, 'concat');
    try {
      const page = await readJsonlFileForward({ filePath, offsetBytes: 0, maxBytes: 64 * 1024, maxItems: 1 });
      const assembledBytes = concat.mock.results.reduce((sum, result) =>
        sum + (result.type === 'return' && Buffer.isBuffer(result.value) ? result.value.length : 0), 0);
      expect(page.items[0]?.value).toEqual(value);
      expect(page.nextOffsetBytes).toBe(Buffer.byteLength(source));
      expect(assembledBytes).toBeLessThanOrEqual(Buffer.byteLength(source) * 2);
    } finally {
      concat.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves offsets across split UTF-8, malformed rows and item-limited resumes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-boundaries-'));
    const filePath = join(dir, 'synthetic.jsonl');
    const first = buildJsonl([{ text: '中文'.repeat(800) }]);
    const malformed = 'bad'.repeat(500) + '\n';
    const last = JSON.stringify({ text: '末行'.repeat(500) });
    try {
      await writeFile(filePath, first + malformed + last);
      const page = await readJsonlFileForward({ filePath, offsetBytes: 0, maxBytes: 20_000, maxItems: 1, chunkBytes: 1024, strictRead: true });
      expect(page.items.map((line) => line.value)).toEqual([{ text: '中文'.repeat(800) }]);
      expect(page.nextOffsetBytes).toBe(Buffer.byteLength(first));
      const rest = await readJsonlFileForward({ filePath, offsetBytes: page.nextOffsetBytes, maxBytes: 20_000, maxItems: 2, chunkBytes: 1024, strictRead: true });
      expect(rest.items.map((line) => line.value)).toEqual([{ text: '末行'.repeat(500) }]);
      expect(rest.items[0]?.startOffsetBytes).toBe(Buffer.byteLength(first + malformed));
      expect(rest.nextOffsetBytes).toBe(Buffer.byteLength(first + malformed + last));
      expect(rest.reachedEnd).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps an unfinished line at its start when the oversize cap is reached', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-cap-'));
    const filePath = join(dir, 'synthetic.jsonl');
    try {
      await writeFile(filePath, buildJsonl([{ text: 'x'.repeat(5000) }]));
      const page = await readJsonlFileForward({ filePath, offsetBytes: 0, maxBytes: 1024, maxItems: 2, chunkBytes: 1024, maxOversizeLineBytes: 2048, strictRead: true });
      expect(page).toEqual({ items: [], nextOffsetBytes: 0, truncated: false, reachedEnd: false, hitPageLimit: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

});
