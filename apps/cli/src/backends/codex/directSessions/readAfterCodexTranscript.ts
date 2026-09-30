import type { DirectSessionObservationV1, DirectSessionsSource } from '@happier-dev/protocol';
import type { DirectSessionTranscriptReadAfter } from '@/backends/directSessions/providerOps';

import { readCodexLifecycleObservation } from './readCodexCandidateLifecycle';
import { resolveCodexHomesForDirectSessionsSource } from './resolveCodexHomesForDirectSessionsSource';
import { decodeCodexDirectForwardCursor, encodeCodexDirectForwardCursor } from './codexDirectForwardCursor';
import { collectCodexSessionRolloutFiles, type CodexRolloutFile } from './collectCodexSessionRolloutFiles';
import { readAfterCodexRolloutStreams } from './codexDirectTranscriptStreamPaging';
import {
  mapCodexDirectSessionAppServerPreviewToMessage,
  resolveCodexDirectSessionAppServerMetadata,
} from './resolveCodexDirectSessionAppServerMetadata';

function selectBestCodexHomeWithFiles(
  homes: readonly string[],
  perHomeFiles: readonly (readonly CodexRolloutFile[])[],
): Readonly<{ home: string; files: readonly CodexRolloutFile[] }> | null {
  let bestHome: string | null = null;
  let bestFiles: readonly CodexRolloutFile[] = [];
  let bestLatestMtimeMs = -1;
  for (let index = 0; index < homes.length; index += 1) {
    const home = homes[index]!;
    const files = perHomeFiles[index] ?? [];
    if (files.length === 0) continue;
    const latestMtimeMs = Math.max(...files.map((file) => file.mtimeMs));
    if (latestMtimeMs > bestLatestMtimeMs) {
      bestLatestMtimeMs = latestMtimeMs;
      bestHome = home;
      bestFiles = files;
    }
  }
  return bestHome ? { home: bestHome, files: bestFiles } : null;
}

/** 沿既有来源读取增量；观察订阅可同时读取同一来源的当前生命周期，不改变正文游标。 */
export async function readAfterCodexTranscript(params: Readonly<{
  source: DirectSessionsSource;
  activeServerDir: string;
  env?: NodeJS.ProcessEnv;
  remoteSessionId: string;
  cursor: string;
  maxBytes: number;
  maxItems: number;
  projection?: 'conversation_text';
  scanMaxBytes?: number;
  includeLifecycleObservation?: boolean;
}>): Promise<DirectSessionTranscriptReadAfter & { lifecycleObservation?: DirectSessionObservationV1 }> {
  const env = params.env ?? process.env;
  const homes = await resolveCodexHomesForDirectSessionsSource({
    source: params.source,
    activeServerDir: params.activeServerDir,
    env,
  });

  const perHomeFiles = await Promise.all(homes.map((home) => collectCodexSessionRolloutFiles({ codexHome: home, remoteSessionId: params.remoteSessionId })));
  const bestHome = selectBestCodexHomeWithFiles(homes, perHomeFiles);
  const appServerMetadata = bestHome === null
    ? await resolveCodexDirectSessionAppServerMetadata({
      source: params.source,
      activeServerDir: params.activeServerDir,
      remoteSessionId: params.remoteSessionId,
      env,
    })
    : null;

  if (bestHome === null) {
    const historyAvailability = appServerMetadata?.previewText ? 'preview_only' as const : 'unavailable' as const;
    if (params.cursor === 'tail' && appServerMetadata) {
      return {
        historyAvailability,
        items: [],
        nextCursor: encodeCodexDirectForwardCursor({
          v: 2,
          kind: 'codexForwardAppServer',
          updatedAtMs: appServerMetadata.updatedAtMs,
          previewText: appServerMetadata.previewText,
        }),
        truncated: false,
      };
    }

    const decodedEmpty = params.cursor === 'tail' ? null : decodeCodexDirectForwardCursor(params.cursor);
    if (decodedEmpty?.kind === 'codexForwardAppServer') {
      const nextMetadata = appServerMetadata;
      const changed = nextMetadata
        ? nextMetadata.updatedAtMs !== decodedEmpty.updatedAtMs || nextMetadata.previewText !== decodedEmpty.previewText
        : false;
      const previewItem = changed && nextMetadata
        ? mapCodexDirectSessionAppServerPreviewToMessage({ remoteSessionId: params.remoteSessionId, metadata: nextMetadata })
        : null;
      const nextCursor = encodeCodexDirectForwardCursor({
        v: 2,
        kind: 'codexForwardAppServer',
        updatedAtMs: appServerMetadata?.updatedAtMs ?? decodedEmpty.updatedAtMs,
        previewText: appServerMetadata?.previewText ?? decodedEmpty.previewText,
      });
      return { items: previewItem ? [previewItem] : [], nextCursor, truncated: false, historyAvailability };
    }

    return { items: [], nextCursor: params.cursor === 'tail' ? null : params.cursor, truncated: false, historyAvailability };
  }

  try {
    const page = await readAfterCodexRolloutStreams({
      codexHome: bestHome.home,
      remoteSessionId: params.remoteSessionId,
      cursor: params.cursor,
      maxBytes: params.maxBytes,
      maxItems: params.maxItems,
      projection: params.projection,
      scanMaxBytes: params.scanMaxBytes,
      initialRolloutFiles: bestHome.files,
    });
    // 文件选择沿原 transcript 来源；多个文件仍需原前向连续性证明，不能凭修改时间判当前轮。
    const lifecycleObservation: DirectSessionObservationV1 | undefined = !params.includeLifecycleObservation ? undefined
      : bestHome.files.length === 1
        ? await readCodexLifecycleObservation({ filePath: bestHome.files[0]!.filePath, remoteSessionId: params.remoteSessionId })
        : { v: 1, state: 'unknown', reason: 'not_observed' };
    return { ...page, historyAvailability: 'available', ...(lifecycleObservation ? { lifecycleObservation } : {}) };
  } catch {
    // 保留输入进度；本次失败不授权任何客户端推进已接受的历史边界。
    return { items: [], nextCursor: params.cursor === 'tail' ? null : params.cursor, truncated: false, historyAvailability: 'unavailable' };
  }
}
