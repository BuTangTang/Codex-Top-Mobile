import { open, stat } from 'node:fs/promises';

import { tryParseJsonlLine } from './jsonlParse';

const DEFAULT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_OVERSIZE_LINE_BYTES = 8 * 1024 * 1024;

export type JsonlParsedLine = Readonly<{
  value: unknown;
  startOffsetBytes: number;
  endOffsetBytes: number;
}>;

/** 逆向逐块定位完整行，只有到达行边界时才拼接，保留原字节游标语义。 */
export async function readJsonlFileBackwardPage(params: Readonly<{
  filePath: string;
  endOffsetBytes: number | null;
  maxBytes: number;
  maxItems: number;
  chunkBytes?: number;
  maxOversizeLineBytes?: number;
  /** 严格调用方必须区分读取失败与正常空页；默认兼容其他 provider。 */
  strictRead?: boolean;
}>): Promise<Readonly<{
  items: readonly JsonlParsedLine[];
  nextEndOffsetBytes: number;
  reachedStart: boolean;
  // The consumed boundary at this page's end, excluding any incomplete terminal line.
  // Null means the existing read budget could not locate that line's start.
  tailOffsetBytes: number | null;
}>> {
  const maxBytes = Math.max(1, Math.trunc(params.maxBytes));
  const maxItems = Math.max(1, Math.trunc(params.maxItems));
  const chunkBytes = Math.max(1024, Math.trunc(params.chunkBytes ?? DEFAULT_CHUNK_BYTES));
  const maxOversizeLineBytes = Math.max(
    maxBytes,
    Math.trunc(params.maxOversizeLineBytes ?? DEFAULT_MAX_OVERSIZE_LINE_BYTES),
  );

  let fileSize = 0;
  try {
    const s = await stat(params.filePath);
    fileSize = s.size;
  } catch (error) {
    if (params.strictRead) throw error;
    return { items: [], nextEndOffsetBytes: 0, reachedStart: true, tailOffsetBytes: 0 };
  }

  const initialEnd = (() => {
    if (typeof params.endOffsetBytes !== 'number' || !Number.isFinite(params.endOffsetBytes)) return fileSize;
    return Math.min(fileSize, Math.max(0, Math.trunc(params.endOffsetBytes)));
  })();

  if (initialEnd <= 0) {
    if (params.strictRead) {
      const emptyFile = await open(params.filePath, 'r');
      await emptyFile.close();
    }
    return { items: [], nextEndOffsetBytes: 0, reachedStart: true, tailOffsetBytes: 0 };
  }

  const collectedNewestFirst: JsonlParsedLine[] = [];
  let bytesReadTotal = 0;
  let end = initialEnd;
  // 分片按从新到旧的顺序保留；已扫描分片不再参与下一块的扫描或复制。
  let carryParts: Buffer[] = [];
  let carryBytes = 0;
  let tailOffsetBytes: number | null = null;
  let oldestConsumedStartOffsetBytes: number | null = null;

  const fh = await open(params.filePath, 'r');
  try {
    while (end > 0 && collectedNewestFirst.length < maxItems) {
      const remainingBytes = maxBytes - bytesReadTotal;
      const canContinueOversizeFirstLine =
        remainingBytes <= 0 &&
        collectedNewestFirst.length === 0 &&
        carryBytes > 0 &&
        carryBytes < maxOversizeLineBytes;
      if (remainingBytes <= 0 && !canContinueOversizeFirstLine) break;

      const oversizeRemainingBytes = maxOversizeLineBytes - carryBytes;
      const readBudget = canContinueOversizeFirstLine ? oversizeRemainingBytes : remainingBytes;
      const readSize = Math.min(chunkBytes, end, readBudget);
      if (readSize <= 0) break;

      const start = end - readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      const readRes = await fh.read(buffer, 0, readSize, start);
      if (params.strictRead && readRes.bytesRead !== readSize) throw new Error('Transcript source changed while reading');
      const chunk = readRes.bytesRead > 0 ? buffer.subarray(0, readRes.bytesRead) : Buffer.alloc(0);
      bytesReadTotal += chunk.length;

      let segmentEndIndex = chunk.length;
      for (let i = chunk.length - 1; i >= 0 && collectedNewestFirst.length < maxItems; i--) {
        if (chunk[i] !== 0x0a) continue; // '\n'
        const segmentStartIndex = i + 1;
        const endOffsetAbs = start + segmentEndIndex + carryBytes;
        const head = chunk.subarray(segmentStartIndex, segmentEndIndex);
        const segment = carryBytes > 0 ? Buffer.concat([head, ...carryParts.reverse()], head.length + carryBytes) : head;
        carryParts = [];
        carryBytes = 0;
        segmentEndIndex = i;

        const startOffsetAbs = start + segmentStartIndex;
        const parsed = tryParseJsonlLine(segment);
        oldestConsumedStartOffsetBytes = oldestConsumedStartOffsetBytes === null
          ? startOffsetAbs
          : Math.min(oldestConsumedStartOffsetBytes, startOffsetAbs);
        if (tailOffsetBytes === null) {
          tailOffsetBytes = segment.length === 0 || parsed !== null ? initialEnd : startOffsetAbs;
        }
        if (parsed === null) continue;

        collectedNewestFirst.push({ value: parsed, startOffsetBytes: startOffsetAbs, endOffsetBytes: endOffsetAbs });
      }

      if (segmentEndIndex > 0) {
        carryParts.push(chunk.subarray(0, segmentEndIndex));
        carryBytes += segmentEndIndex;
      }
      end = start;

      if (end === 0 && carryBytes > 0 && collectedNewestFirst.length < maxItems) {
        const line = carryParts.length === 1 ? carryParts[0]! : Buffer.concat(carryParts.reverse(), carryBytes);
        const parsed = tryParseJsonlLine(line);
        oldestConsumedStartOffsetBytes = 0;
        if (tailOffsetBytes === null) tailOffsetBytes = parsed !== null ? initialEnd : 0;
        if (parsed !== null) {
          collectedNewestFirst.push({ value: parsed, startOffsetBytes: 0, endOffsetBytes: carryBytes });
          carryParts = [];
          carryBytes = 0;
        }
      }
    }
  } finally {
    await fh.close();
  }

  const items = collectedNewestFirst.reverse();
  const nextEndOffsetBytes = items.length > 0
    ? items[0].startOffsetBytes
    : (oldestConsumedStartOffsetBytes ?? initialEnd);
  const reachedStart = nextEndOffsetBytes <= 0;
  return { items, nextEndOffsetBytes, reachedStart, tailOffsetBytes };
}
