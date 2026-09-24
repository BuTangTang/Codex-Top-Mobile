import { describe, expect, it } from 'vitest';
import type { MemoryStatusV1 } from '@happier-dev/protocol';

import { isDaemonMemorySearchUsable } from './isDaemonMemorySearchUsable';

function buildStatus(overrides: Partial<MemoryStatusV1> & Record<string, unknown> = {}): MemoryStatusV1 {
  const status: MemoryStatusV1 = {
    v: 1,
    enabled: true,
    indexMode: 'hints',
    hintsIndexReady: true,
    hintsIndexHasContent: false,
    deepIndexReady: false,
    deepIndexHasContent: false,
    activeIndexReady: true,
    activeIndexSearchable: false,
    embeddingsEnabled: false,
    embeddingsMode: 'disabled',
    embeddingsPresetId: null,
    embeddingsProviderKind: null,
    embeddingsModelId: null,
    embeddingsRuntimeState: 'ready',
    embeddingsUsingFallback: false,
    tier1DbPath: '/tmp/memory.sqlite',
    deepDbPath: null,
    tier1DbBytes: 512,
    deepDbBytes: null,
    indexContent: null,
    worker: null,
    queue: null,
    lastRun: null,
  };
  Object.assign(status, overrides);
  return status;
}

describe('isDaemonMemorySearchUsable', () => {
  it('does not treat active index path readiness as searchable readiness', () => {
    expect(isDaemonMemorySearchUsable(buildStatus({
      activeIndexReady: true,
      activeIndexSearchable: false,
    }))).toBe(false);
  });

  it('accepts explicit active searchable readiness from the daemon', () => {
    expect(isDaemonMemorySearchUsable(buildStatus({
      activeIndexReady: true,
      activeIndexSearchable: true,
    }))).toBe(true);
  });

  it('does not use content counts as a substitute for searchable readiness', () => {
    expect(isDaemonMemorySearchUsable(buildStatus({
      activeIndexReady: true,
      activeIndexSearchable: false,
      indexContent: {
        lightShardCount: 1,
        lightTermCount: 8,
        deepChunkCount: 0,
        deepEmbeddingCount: 0,
        searchableSessionCount: 1,
        lastIndexedAtMs: 1,
        latestIndexedMessageAtMs: 1,
      },
    }))).toBe(false);
  });

  it('does not treat missing telemetry as usable just because the DB path is ready', () => {
    expect(isDaemonMemorySearchUsable(buildStatus({
      activeIndexReady: true,
    }))).toBe(false);
  });
});
