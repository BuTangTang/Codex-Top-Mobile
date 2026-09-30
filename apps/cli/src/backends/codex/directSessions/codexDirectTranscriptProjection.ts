import type { DirectTranscriptRawMessageV1, DirectSessionAttachmentV1 } from '@happier-dev/protocol';

import { mapCodexRolloutEventToActions, type CodexRolloutHistoryMode } from '../localControl/rolloutMapper';
import { createCodexRolloutSemanticTracker } from '../rollout/createCodexRolloutSemanticTracker';
import type { CodexRolloutFile } from './collectCodexSessionRolloutFiles';
import { mapCodexRolloutLineToDirectMessages } from './mapCodexRolloutLineToDirectMessages';

/** 只认原生 envelope 开头的顶层 compacted；不在 payload 或正文内搜索相同文字。 */
export function isCodexCompactedLinePrefix(prefix: Buffer): boolean {
  // 原生序列化的 timestamp、ordinal 可在 type 前；只跨过这两个已知标量，不能进入 payload 或正文。
  return /^\s*\{\s*(?:(?:"timestamp"\s*:\s*"[^"\\]*"|"ordinal"\s*:\s*\d+)\s*,\s*)*"type"\s*:\s*"compacted"\s*,/.test(prefix.subarray(0, 1024).toString('utf8'));
}

export type CodexDirectTranscriptRolloutStream = CodexRolloutFile & Readonly<{
  threadId: string;
  sidechainId: string | null;
}>;

export type CodexStreamProgress = Readonly<{
  nextOffsetBytes: number;
  subIndex: number;
}>;

export type CodexProjectedTranscriptRecord = Readonly<{
  item: DirectTranscriptRawMessageV1;
  streamId: string;
  lineStartOffsetBytes: number;
  lineNextOffsetBytes: number;
  subIndex: number;
  lineRecordCount: number;
}>;

export function measureDirectTranscriptItemBytes(item: DirectTranscriptRawMessageV1): number {
  return Buffer.byteLength(JSON.stringify(item), 'utf8');
}

function compareDirectTranscriptItemsOldestFirst(left: DirectTranscriptRawMessageV1, right: DirectTranscriptRawMessageV1): number {
  if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
  return left.id.localeCompare(right.id);
}

export function compareCodexProjectedRecordsOldestFirst(
  left: CodexProjectedTranscriptRecord,
  right: CodexProjectedTranscriptRecord,
): number {
  return compareDirectTranscriptItemsOldestFirst(left.item, right.item);
}

/** 将单条 rollout 归一化为带分页位置的 direct 消息，并收集其中发现的子任务。 */
export function projectCodexRolloutLineToTranscriptRecords(params: Readonly<{
  stream: CodexDirectTranscriptRolloutStream;
  lineStartOffsetBytes: number;
  lineNextOffsetBytes: number;
  lineValue: unknown;
  generatedAttachments?: readonly DirectSessionAttachmentV1[];
  historyMode?: CodexRolloutHistoryMode;
  semanticTracker: ReturnType<typeof createCodexRolloutSemanticTracker>;
}>): Readonly<{ records: readonly CodexProjectedTranscriptRecord[]; discoveredChildThreadIds: readonly string[] }> {
  const discoveredChildThreadIds = new Set<string>();
  const normalizedActions = mapCodexRolloutEventToActions(params.lineValue, { debug: true, historyMode: params.historyMode })
    .flatMap((action) => params.semanticTracker.consume(action));
  for (const action of normalizedActions) {
    if (action.type === 'subagent-spawn') {
      discoveredChildThreadIds.add(action.threadId);
    }
  }

  const items = mapCodexRolloutLineToDirectMessages({
    fileRelPath: params.stream.fileRelPath,
    lineStartOffsetBytes: params.lineStartOffsetBytes,
    lineValue: params.lineValue,
    actions: normalizedActions,
    sidechainId: params.stream.sidechainId,
    generatedAttachments: params.generatedAttachments,
  });
  return {
    discoveredChildThreadIds: [...discoveredChildThreadIds],
    records: items.map((item, subIndex) => ({
      item,
      streamId: params.stream.fileRelPath,
      lineStartOffsetBytes: params.lineStartOffsetBytes,
      lineNextOffsetBytes: params.lineNextOffsetBytes,
      subIndex,
      lineRecordCount: items.length,
    })),
  };
}
