import { open, stat } from 'node:fs/promises';

import { tryParseJsonlLine } from './jsonlParse';
import type { JsonlParsedLine } from './jsonlBackwardPager';

const DEFAULT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_OVERSIZE_LINE_BYTES = 8 * 1024 * 1024;

/** 按完整 JSONL 行前进；超长行只扫描新块，保留既有预算与偏移语义。 */
export async function readJsonlFileForward(params: Readonly<{
  filePath: string;
  offsetBytes: number;
  maxBytes: number;
  maxItems: number;
  chunkBytes?: number;
  maxOversizeLineBytes?: number;
  /** 严格调用方必须区分读取失败与正常空页；默认兼容其他 provider。 */
  strictRead?: boolean;
}>): Promise<Readonly<{
  items: readonly JsonlParsedLine[];
  nextOffsetBytes: number;
  truncated: boolean;
  reachedEnd: boolean;
  hitPageLimit: boolean;
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
    return { items: [], nextOffsetBytes: 0, truncated: true, reachedEnd: true, hitPageLimit: false };
  }

  const offsetBytes = Math.max(0, Math.trunc(params.offsetBytes));
  if (offsetBytes > fileSize) {
    return { items: [], nextOffsetBytes: 0, truncated: true, reachedEnd: true, hitPageLimit: false };
  }

  const fh = await open(params.filePath, 'r');
  const items: JsonlParsedLine[] = [];
  let bytesReadTotal = 0;

  // 未完成行保留分片；遇换行才拼接，避免每块重复复制与扫描整条长行。
  let carryParts: Buffer[] = [];
  let carryBytes = 0;
  let carryStartOffset = offsetBytes;
  let nextReadOffset = offsetBytes;

  try {
    while (nextReadOffset < fileSize && items.length < maxItems) {
      const remainingBytes = maxBytes - bytesReadTotal;
      const canContinueOversizeFirstLine =
        remainingBytes <= 0 &&
        items.length === 0 &&
        carryBytes > 0 &&
        carryBytes < maxOversizeLineBytes;
      if (remainingBytes <= 0 && !canContinueOversizeFirstLine) break;

      const oversizeRemainingBytes = maxOversizeLineBytes - carryBytes;
      const readBudget = canContinueOversizeFirstLine ? oversizeRemainingBytes : remainingBytes;
      const readSize = Math.min(chunkBytes, fileSize - nextReadOffset, readBudget);
      if (readSize <= 0) break;

      const buffer = Buffer.allocUnsafe(readSize);
      const res = await fh.read(buffer, 0, readSize, nextReadOffset);
      if (params.strictRead && res.bytesRead !== readSize) throw new Error('Transcript source changed while reading');
      const chunk = res.bytesRead > 0 ? buffer.subarray(0, res.bytesRead) : Buffer.alloc(0);
      bytesReadTotal += chunk.length;
      nextReadOffset += chunk.length;

      const chunkStartOffset = nextReadOffset - chunk.length;
      let lineStartIndex = 0;
      // 旧分片已扫描过，只检查当前块；完整行的字节偏移不受 UTF-8 分块影响。
      for (let i = 0; i < chunk.length && items.length < maxItems; i++) {
        if (chunk[i] !== 0x0a) continue;
        const segment = chunk.subarray(lineStartIndex, i);
        const line = carryBytes > 0
          ? Buffer.concat([...carryParts, segment], carryBytes + segment.length)
          : segment;
        const parsed = tryParseJsonlLine(line);
        if (parsed !== null) {
          items.push({ value: parsed, startOffsetBytes: carryStartOffset, endOffsetBytes: chunkStartOffset + i });
        }
        carryParts = [];
        carryBytes = 0;
        lineStartIndex = i + 1;
        carryStartOffset = chunkStartOffset + lineStartIndex;
      }
      // 达到条数上限后的剩余数据仍属于未消费区，下一页从完整行边界重新读取。
      if (lineStartIndex < chunk.length) {
        const remainder = chunk.subarray(lineStartIndex);
        carryParts.push(remainder);
        carryBytes += remainder.length;
      }
    }

    // Best-effort: parse a trailing line without newline if it appears valid.
    // This helps for completed transcripts that don't end in \n.
    if (items.length < maxItems && nextReadOffset >= fileSize && carryBytes > 0) {
      const trailingLine = carryParts.length === 1 ? carryParts[0]! : Buffer.concat(carryParts, carryBytes);
      const parsed = tryParseJsonlLine(trailingLine);
      if (parsed !== null) {
        items.push({ value: parsed, startOffsetBytes: carryStartOffset, endOffsetBytes: carryStartOffset + carryBytes });
        carryParts = [];
        carryBytes = 0;
        carryStartOffset = fileSize;
      }
    }
  } finally {
    await fh.close();
  }

  const reachedEnd = carryBytes === 0 && nextReadOffset >= fileSize;
  // An incomplete terminal line alone is not a backlog: retain its start until the writer completes it.
  const hitPageLimit = !reachedEnd && (items.length >= maxItems || nextReadOffset < fileSize);
  return { items, nextOffsetBytes: carryStartOffset, truncated: false, reachedEnd, hitPageLimit };
}
