import type { DirectSessionsSource } from '@happier-dev/protocol';
import type { DirectSessionTranscriptReadAfter } from '@/backends/directSessions/providerOps';

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

export async function readAfterCodexTranscript(params: Readonly<{
  source: DirectSessionsSource;
  activeServerDir: string;
  env?: NodeJS.ProcessEnv;
  remoteSessionId: string;
  cursor: string;
  maxBytes: number;
  maxItems: number;
}>): Promise<DirectSessionTranscriptReadAfter> {
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
      initialRolloutFiles: bestHome.files,
    });
    return { ...page, historyAvailability: 'available' };
  } catch {
    // 保留输入进度；本次失败不授权任何客户端推进已接受的历史边界。
    return { items: [], nextCursor: params.cursor === 'tail' ? null : params.cursor, truncated: false, historyAvailability: 'unavailable' };
  }
}
