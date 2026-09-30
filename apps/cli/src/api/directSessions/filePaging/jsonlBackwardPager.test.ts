import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { readJsonlFileBackwardPage } from './jsonlBackwardPager';

function buildJsonl(lines: unknown[], opts?: { trailingNewline?: boolean }): string {
  const trailingNewline = opts?.trailingNewline !== false;
  const joined = lines.map((line) => JSON.stringify(line)).join('\n');
  return trailingNewline ? `${joined}\n` : joined;
}

describe('readJsonlFileBackwardPage', () => {
  it('reports missing files in strict reads while preserving legacy default behavior', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-jsonl-missing-'));
    const params = { filePath: join(root, 'missing.jsonl'), endOffsetBytes: null, maxBytes: 1024, maxItems: 2 };
    await expect(readJsonlFileBackwardPage(params)).resolves.toMatchObject({ items: [], reachedStart: true });
    await expect(readJsonlFileBackwardPage({ ...params, strictRead: true })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('pages backward from the end in stable order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-backward-'));
    const filePath = join(dir, 't.jsonl');
    await writeFile(filePath, buildJsonl([{ i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }, { i: 5 }]), 'utf8');

    const page1 = await readJsonlFileBackwardPage({ filePath, endOffsetBytes: null, maxBytes: 1024, maxItems: 2 });
    expect(page1.items.map((x) => (x.value as any).i)).toEqual([4, 5]);
    expect(page1.reachedStart).toBe(false);

    const page2 = await readJsonlFileBackwardPage({ filePath, endOffsetBytes: page1.nextEndOffsetBytes, maxBytes: 1024, maxItems: 2 });
    expect(page2.items.map((x) => (x.value as any).i)).toEqual([2, 3]);

    const page3 = await readJsonlFileBackwardPage({ filePath, endOffsetBytes: page2.nextEndOffsetBytes, maxBytes: 1024, maxItems: 2 });
    expect(page3.items.map((x) => (x.value as any).i)).toEqual([1]);
    expect(page3.reachedStart).toBe(true);
  });

  it('includes a trailing line even when the file has no terminal newline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-backward-'));
    const filePath = join(dir, 't.jsonl');
    await writeFile(filePath, buildJsonl([{ i: 1 }, { i: 2 }], { trailingNewline: false }), 'utf8');

    const page = await readJsonlFileBackwardPage({ filePath, endOffsetBytes: null, maxBytes: 1024, maxItems: 10 });
    expect(page.items.map((x) => (x.value as any).i)).toEqual([1, 2]);
    expect(page.tailOffsetBytes).toBe(Buffer.byteLength(buildJsonl([{ i: 1 }, { i: 2 }], { trailingNewline: false })));
  });

  it('keeps an incomplete terminal line outside the consumed tail boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-backward-'));
    const filePath = join(dir, 't.jsonl');
    const complete = buildJsonl([{ i: 1 }]);
    await writeFile(filePath, complete + JSON.stringify({ i: 2 }).slice(0, -1), 'utf8');

    const page = await readJsonlFileBackwardPage({ filePath, endOffsetBytes: null, maxBytes: 1024, maxItems: 1 });
    expect(page.items.map((line) => line.value)).toEqual([{ i: 1 }]);
    expect(page.tailOffsetBytes).toBe(Buffer.byteLength(complete));
  });

  it('leaves the tail boundary unknown when the existing read budget cannot locate its line start', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-backward-'));
    const filePath = join(dir, 't.jsonl');
    await writeFile(filePath, JSON.stringify({ text: 'x'.repeat(4096) }).slice(0, -1), 'utf8');

    const page = await readJsonlFileBackwardPage({
      filePath, endOffsetBytes: null, maxBytes: 1024, maxItems: 1, maxOversizeLineBytes: 1024,
    });
    expect(page.items).toEqual([]);
    expect(page.tailOffsetBytes).toBeNull();
  });

  it('advances past complete malformed rows without stalling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-backward-'));
    const filePath = join(dir, 't.jsonl');
    const malformed = `not-json-${'x'.repeat(700)}\n`;
    await writeFile(filePath, malformed + malformed, 'utf8');

    const malformedPage = await readJsonlFileBackwardPage({
      filePath,
      endOffsetBytes: null,
      maxBytes: 1024,
      maxItems: 1,
      maxOversizeLineBytes: 1024,
    });
    expect(malformedPage.items).toEqual([]);
    expect(malformedPage.nextEndOffsetBytes).toBe(0);
    expect(malformedPage.reachedStart).toBe(true);
  });

  it('keeps scanning backward until it can parse an oversized newest unread line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-backward-'));
    const filePath = join(dir, 't.jsonl');
    const oversized = { i: 2, payload: 'x'.repeat(6 * 1024) };
    await writeFile(filePath, buildJsonl([{ i: 1 }, oversized, { i: 3 }]), 'utf8');

    const page1 = await readJsonlFileBackwardPage({ filePath, endOffsetBytes: null, maxBytes: 1024, maxItems: 1 });
    expect(page1.items.map((x) => (x.value as any).i)).toEqual([3]);

    const page2 = await readJsonlFileBackwardPage({
      filePath,
      endOffsetBytes: page1.nextEndOffsetBytes,
      maxBytes: 1024,
      maxItems: 1,
    });
    expect(page2.items.map((x) => (x.value as any).i)).toEqual([2]);
    expect(page2.nextEndOffsetBytes).toBeLessThan(page1.nextEndOffsetBytes);
  });

  it('copies a multibyte oversized row only at its boundary and preserves order, offsets and incomplete tail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-jsonl-backward-fragments-'));
    const filePath = join(dir, 't.jsonl');
    const values = [{ i: 1 }, { i: 2, text: '图🙂'.repeat(12 * 1024) }, { i: 3 }];
    const rows = values.map((value) => `${JSON.stringify(value)}\n`);
    const complete = rows.join('');
    const bytes = Buffer.from(complete);
    await writeFile(filePath, complete + '{"unfinished":');
    let copiedBytes = 0;
    const concat = Buffer.concat;
    const spy = vi.spyOn(Buffer, 'concat').mockImplementation((list, length) => {
      copiedBytes += length ?? list.reduce((sum, value) => sum + value.length, 0);
      return concat(list, length);
    });
    try {
      const found = [];
      let endOffsetBytes: number | null = null;
      for (let pageIndex = 0; pageIndex < values.length; pageIndex++) {
        const page = await readJsonlFileBackwardPage({ filePath, endOffsetBytes, maxBytes: 1024, maxItems: 1, chunkBytes: 1024 });
        if (pageIndex === 0) expect(page.tailOffsetBytes).toBe(bytes.length);
        found.unshift(...page.items);
        endOffsetBytes = page.nextEndOffsetBytes;
      }
      expect(found.map((line) => line.value)).toEqual(values);
      expect(endOffsetBytes).toBe(0);
      let start = 0;
      for (let index = 0; index < rows.length; index++) {
        const length = Buffer.byteLength(rows[index]!);
        expect(found[index]).toMatchObject({ startOffsetBytes: start, endOffsetBytes: start + length - 1 });
        expect(JSON.parse(bytes.subarray(start, start + length - 1).toString('utf8'))).toEqual(values[index]);
        start += length;
      }
      // 在真实 Buffer 分配边界测量复制量，避免用易受机器负载影响的毫秒阈值。
      expect(copiedBytes).toBeLessThan(bytes.length * 3);
    } finally {
      spy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
