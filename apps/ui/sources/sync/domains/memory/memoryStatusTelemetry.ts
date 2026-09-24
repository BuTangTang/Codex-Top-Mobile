import type { MemoryStatusV1 } from '@happier-dev/protocol';

export type MemoryIndexContentTelemetry = Readonly<{
  lightShardCount: number;
  lightTermCount: number;
  deepChunkCount: number;
  deepEmbeddingCount: number;
  searchableSessionCount: number;
  lastIndexedAtMs: number | null;
  latestIndexedMessageAtMs: number | null;
}>;

export type MemoryWorkerTelemetry = Readonly<{
  state: 'disabled' | 'idle' | 'inventorying' | 'indexing' | 'waiting' | 'backoff' | 'error';
  lastTickAtMs: number | null;
  lastInventoryAtMs: number | null;
  currentSessionId: string | null;
  currentPhase: string | null;
}>;

export type MemoryQueueTelemetry = Readonly<{
  selectedSessionCount: number;
  queuedSessionCount: number;
  indexingSessionCount: number;
  indexedSessionCount: number;
  emptySessionCount: number;
  failedSessionCount: number;
  waitingSessionCount: number;
  oldestQueuedAtMs: number | null;
}>;

export type MemoryLastRunTelemetry = Readonly<{
  startedAtMs: number | null;
  finishedAtMs: number | null;
  sessionsConsidered: number;
  sessionsProcessed: number;
  rawRowsFetched: number;
  semanticRowsFound: number;
  lightShardsCreated: number;
  deepChunksCreated: number;
  failures: number;
  skipReasons: Readonly<Record<string, number>>;
}>;

export type MemoryStatusTelemetry = MemoryStatusV1 & Readonly<{
  hintsIndexHasContent?: boolean;
  deepIndexHasContent?: boolean;
  activeIndexSearchable?: boolean;
  indexContent?: MemoryIndexContentTelemetry;
  worker?: MemoryWorkerTelemetry;
  queue?: MemoryQueueTelemetry;
  lastRun?: MemoryLastRunTelemetry | null;
}>;

export function readMemoryStatusTelemetry(status: MemoryStatusV1): MemoryStatusTelemetry {
  return status as MemoryStatusTelemetry;
}

export function hasKnownEmptyMemoryIndexContent(status: MemoryStatusV1): boolean {
  const telemetry = readMemoryStatusTelemetry(status);
  const indexContent = telemetry.indexContent;
  if (!indexContent) return false;
  return (
    indexContent.lightShardCount <= 0
    && indexContent.lightTermCount <= 0
    && indexContent.deepChunkCount <= 0
    && indexContent.searchableSessionCount <= 0
  );
}
