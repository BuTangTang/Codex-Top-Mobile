import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionSummaryShardV1, SessionSynopsisV1 } from '@happier-dev/protocol';

import { openSummaryShardIndexDb } from './summaryShardIndexDb';
import type { DecryptedTranscriptRow } from '@/session/replay/decryptTranscriptRows';

describe('syncMemoryHintsForSessionsOnce', () => {
  it('keeps committed summary system records ahead of same-range legacy transcript artifacts', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-system-records-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      let committedLegacyArtifacts = 0;
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-system-record'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'new_only',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => [
          {
            seq: 99,
            createdAtMs: 4000,
            role: 'agent',
            content: { type: 'text', text: '[memory]' },
            meta: {
              happier: {
                kind: 'session_summary_shard.v1',
                payload: {
                  v: 1,
                  seqFrom: 10,
                  seqTo: 12,
                  createdAtFromMs: 1000,
                  createdAtToMs: 2000,
                  summary: 'This stale legacy transcript artifact must not replace the system record.',
                  keywords: ['legacy-only'],
                  entities: [],
                  decisions: [],
                },
              },
            },
          },
        ] satisfies DecryptedTranscriptRow[],
        fetchCommittedSummaryShards: async () => [
          {
            v: 1,
            seqFrom: 10,
            seqTo: 12,
            createdAtFromMs: 1000,
            createdAtToMs: 2000,
            summary: 'The durable system record mentions OpenClaw.',
            keywords: ['openclaw'],
            entities: [],
            decisions: [],
          },
        ],
        runSummarizer: async () => {
          throw new Error('summarizer should not run for committed summary system records');
        },
        commitArtifacts: async () => {
          committedLegacyArtifacts += 1;
        },
      });

      expect(committedLegacyArtifacts).toBe(0);
      expect(tier1.search({ query: 'openclaw', scope: { type: 'global' }, maxResults: 10 })).toHaveLength(1);
      expect(tier1.search({ query: 'legacy-only', scope: { type: 'global' }, maxResults: 10 })).toHaveLength(0);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('migrates legacy summary transcript artifacts into system records and tier1 search', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-legacy-system-records-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const committedArtifacts: Array<Readonly<{
        sessionId: string;
        shardPayload: SessionSummaryShardV1;
        synopsisPayload: SessionSynopsisV1 | null;
      }>> = [];

      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-legacy-artifact'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'new_only',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => [
          {
            seq: 99,
            createdAtMs: 4000,
            role: 'agent',
            content: { type: 'text', text: '[memory]' },
            meta: {
              happier: {
                kind: 'session_summary_shard.v1',
                payload: {
                  v: 1,
                  seqFrom: 1,
                  seqTo: 2,
                  createdAtFromMs: 1000,
                  createdAtToMs: 2000,
                  summary: 'The legacy transcript artifact mentions OpenClaw recovery.',
                  keywords: ['legacy-recovery', 'openclaw'],
                  entities: ['Happier'],
                  decisions: ['Backfill old summary shards'],
                },
              },
            },
          },
        ] satisfies DecryptedTranscriptRow[],
        fetchCommittedSummaryShards: async () => [],
        runSummarizer: async () => {
          throw new Error('summarizer should not run for legacy summary artifacts');
        },
        commitArtifacts: async ({ sessionId, shardPayload, synopsisPayload }) => {
          committedArtifacts.push({ sessionId, shardPayload, synopsisPayload });
        },
      });

      expect(committedArtifacts).toEqual([
        {
          sessionId: 'sess-legacy-artifact',
          shardPayload: {
            v: 1,
            seqFrom: 1,
            seqTo: 2,
            createdAtFromMs: 1000,
            createdAtToMs: 2000,
            summary: 'The legacy transcript artifact mentions OpenClaw recovery.',
            keywords: ['legacy-recovery', 'openclaw'],
            entities: ['Happier'],
            decisions: ['Backfill old summary shards'],
          },
          synopsisPayload: null,
        },
      ]);
      expect(tier1.search({ query: 'legacy-recovery', scope: { type: 'global' }, maxResults: 10 })).toHaveLength(1);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('indexes a short semantic session instead of treating windowSizeMessages as a hard minimum', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-short-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = [
        { seq: 1, createdAtMs: 1000, role: 'user' as const, content: { type: 'text', text: 'short session asks about openclaw' } },
        { seq: 2, createdAtMs: 1001, role: 'agent' as const, content: { type: 'codex', data: { type: 'message', message: 'short session answer mentions semantic memory' } } },
      ];

      let committed = 0;
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-short'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async () =>
          JSON.stringify({
            shard: {
              v: 1,
              seqFrom: 1,
              seqTo: 2,
              createdAtFromMs: 1000,
              createdAtToMs: 1001,
              summary: 'A short OpenClaw semantic memory session was discussed.',
              keywords: ['openclaw', 'semantic'],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          }),
        commitArtifacts: async () => {
          committed += 1;
        },
      });

      expect(committed).toBe(1);
      expect(tier1.search({ query: 'openclaw', scope: { type: 'global' }, maxResults: 10 })).toHaveLength(1);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records queue telemetry for indexed light sessions', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-telemetry-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = [
        { seq: 1, createdAtMs: 1000, role: 'user' as const, content: { type: 'text', text: 'telemetry remembers openclaw' } },
        { seq: 2, createdAtMs: 1001, role: 'agent' as const, content: { type: 'text', text: 'assistant indexes queue metrics' } },
      ] satisfies DecryptedTranscriptRow[];

      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-telemetry'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows,
        runSummarizer: async () =>
          JSON.stringify({
            shard: {
              v: 1,
              seqFrom: 1,
              seqTo: 2,
              createdAtFromMs: 1000,
              createdAtToMs: 1001,
              summary: 'Telemetry captured OpenClaw queue metrics.',
              keywords: ['openclaw'],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          }),
        commitArtifacts: async () => {},
      });

      expect(tier1.getMemoryIndexQueueTelemetry()).toMatchObject({
        selectedSessionCount: 1,
        indexedSessionCount: 1,
        rawRowsFetched: 2,
        semanticRowsFound: 2,
        semanticRowsIndexedLight: 2,
        lightShardCount: 1,
        lastRun: expect.objectContaining({
          indexMode: 'hints',
          sessionsConsidered: 1,
          sessionsProcessed: 1,
          sessionsIndexed: 1,
          rawRowsFetched: 2,
          semanticRowsFound: 2,
          lightShardsCreated: 1,
        }),
      });

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('counts provider assistant semantic messages as indexable light memory content', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-provider-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = [
        { seq: 1, createdAtMs: 1000, role: 'agent' as const, content: { type: 'codex', data: { type: 'token_count' } } },
        { seq: 2, createdAtMs: 1001, role: 'agent' as const, content: { type: 'codex', data: { type: 'message', message: 'codex assistant explained nectar indexing' } } },
        { seq: 3, createdAtMs: 1002, role: 'agent' as const, content: { type: 'output', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'claude output covered orchard recall' }] } } } },
      ];

      let promptText = '';
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-provider'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async (prompt) => {
          promptText = prompt;
          return JSON.stringify({
            shard: {
              v: 1,
              seqFrom: 2,
              seqTo: 3,
              createdAtFromMs: 1001,
              createdAtToMs: 1002,
              summary: 'Provider assistant messages discussed nectar and orchard recall.',
              keywords: ['nectar', 'orchard'],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          });
        },
        commitArtifacts: async () => {},
      });

      expect(promptText).toContain('codex assistant explained nectar indexing');
      expect(promptText).toContain('claude output covered orchard recall');
      expect(promptText).not.toContain('token_count');

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('adds semantic window terms to shard search without relying on model-selected keywords', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-window-terms-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = [
        { seq: 1, createdAtMs: 1000, role: 'user' as const, content: { type: 'text', text: 'remember first sentinel ALPHA_MEMORY_SENTINEL' } },
        { seq: 2, createdAtMs: 1001, role: 'user' as const, content: { type: 'text', text: 'remember unique term ZEBRAXYLON' } },
      ];

      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-window-terms'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async () =>
          JSON.stringify({
            shard: {
              v: 1,
              seqFrom: 1,
              seqTo: 2,
              createdAtFromMs: 1000,
              createdAtToMs: 1001,
              summary: 'The model only retained ALPHA_MEMORY_SENTINEL.',
              keywords: ['ALPHA_MEMORY_SENTINEL'],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          }),
        commitArtifacts: async () => {},
      });

      const hits = tier1.search({ query: 'ZEBRAXYLON', scope: { type: 'global' }, maxResults: 10 });
      expect(hits.map((hit) => hit.sessionId)).toEqual(['sess-window-terms']);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generates and indexes a new summary shard when a session has enough new messages', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = Array.from({ length: 40 }).map((_, i) => ({
        seq: i + 1,
        createdAtMs: 1000 + i,
        role: 'user' as const,
        content: { type: 'text', text: `message ${i} about openclaw` },
      }));

      let committed = 0;
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-1'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows,
        runSummarizer: async () =>
          JSON.stringify({
            shard: {
              v: 1,
              seqFrom: 1,
              seqTo: 40,
              createdAtFromMs: 1000,
              createdAtToMs: 1039,
              summary: 'We discussed OpenClaw memory search.',
              keywords: ['openclaw'],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          }),
        commitArtifacts: async () => {
          committed += 1;
        },
      });

      expect(committed).toBe(1);

      const hits = tier1.search({ query: 'openclaw', scope: { type: 'global' }, maxResults: 10 });
      expect(hits.length).toBe(1);
      expect(hits[0]!.sessionId).toBe('sess-1');

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not backfill old messages when backfillPolicy=new_only and the session is uninitialized', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-new-only-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = Array.from({ length: 40 }).map((_, i) => ({
        seq: i + 1,
        createdAtMs: 1000 + i,
        role: 'user' as const,
        content: { type: 'text', text: `message ${i} about openclaw` },
      }));

      let summarizerCalls = 0;
      let committed = 0;

      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-1'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'new_only',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async () => {
          summarizerCalls += 1;
          return '{}';
        },
        commitArtifacts: async () => {
          committed += 1;
        },
      });

      expect(summarizerCalls).toBe(0);
      expect(committed).toBe(0);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('seeds uninitialized new_only sessions from the observed session seq without fetching old transcript rows', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-new-only-seed-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      let transcriptFetches = 0;
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-1'],
        initialCursorSeqBySessionId: new Map([['sess-1', 40]]),
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'new_only',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => {
          transcriptFetches += 1;
          return [];
        },
        runSummarizer: async () => '{}',
        commitArtifacts: async () => {},
      });

      expect(transcriptFetches).toBe(0);
      expect(tier1.getSessionCursors({ sessionId: 'sess-1', nowMs: 5000 }).lastHintedSeq).toBe(40);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('indexes the first shard for a newly-created session when new_only explicitly allows initial backfill', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-new-only-allowed-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = Array.from({ length: 40 }).map((_, i) => ({
        seq: i + 1,
        createdAtMs: 1000 + i,
        role: 'user' as const,
        content: { type: 'text', text: `message ${i} about openclaw memory search` },
      }));

      let committed = 0;
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-1'],
        allowInitialBackfillWhenUninitializedSessionIds: ['sess-1'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'new_only',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async () =>
          JSON.stringify({
            shard: {
              v: 1,
              seqFrom: 1,
              seqTo: 40,
              createdAtFromMs: 1000,
              createdAtToMs: 1039,
              summary: 'We discussed OpenClaw memory search integration.',
              keywords: ['openclaw', 'memory'],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          }),
        commitArtifacts: async () => {
          committed += 1;
        },
      });

      expect(committed).toBe(1);
      expect(tier1.search({ query: 'openclaw', scope: { type: 'global' }, maxResults: 10 })).toHaveLength(1);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('respects maxRunsPerHour by throttling repeated hint runs for the same session', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-throttle-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows40 = Array.from({ length: 40 }).map((_, i) => ({
        seq: i + 1,
        createdAtMs: 1000 + i,
        role: 'user' as const,
        content: { type: 'text', text: `message ${i} about openclaw` },
      }));
      const rows80 = Array.from({ length: 80 }).map((_, i) => ({
        seq: i + 1,
        createdAtMs: 2000 + i,
        role: 'user' as const,
        content: { type: 'text', text: `message ${i} about openclaw` },
      }));

      let rows: any[] = rows40;
      let summarizerCalls = 0;
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-1'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 1,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 10_000,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async () => {
          summarizerCalls += 1;
          return JSON.stringify({
            shard: {
              v: 1,
              seqFrom: 1,
              seqTo: rows.length,
              createdAtFromMs: 1000,
              createdAtToMs: 1000 + rows.length - 1,
              summary: 'first',
              keywords: ['first'],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          });
        },
        commitArtifacts: async () => {},
      });

      rows = rows80;
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-1'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 1,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 10_100,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async () => {
          summarizerCalls += 1;
          return JSON.stringify({
            shard: {
              v: 1,
              seqFrom: 1,
              seqTo: rows.length,
              createdAtFromMs: 1000,
              createdAtToMs: 1000 + rows.length - 1,
              summary: 'second',
              keywords: ['second'],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          });
        },
        commitArtifacts: async () => {},
      });

      expect(summarizerCalls).toBe(1);
      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('evicts older hint shards when maxShardsPerSession is exceeded', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-evict-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows40 = Array.from({ length: 40 }).map((_, i) => ({
        seq: i + 1,
        createdAtMs: 1000 + i,
        role: 'user' as const,
        content: { type: 'text', text: `message ${i} about openclaw` },
      }));
      const rows80 = Array.from({ length: 80 }).map((_, i) => ({
        seq: i + 1,
        createdAtMs: 2000 + i,
        role: 'user' as const,
        content: { type: 'text', text: `message ${i} about openclaw` },
      }));

      let rows: any[] = rows40;
      let call = 0;
      const runOnce = async () => {
        await syncMemoryHintsForSessionsOnce({
          sessionIds: ['sess-1'],
          tier1,
          settings: {
            enabled: true,
            indexMode: 'hints',
            backfillPolicy: 'all_history',
            hints: {
              updateMode: 'continuous',
              idleDelayMs: 0,
              windowSizeMessages: 40,
              maxShardChars: 12_000,
              maxSummaryChars: 500,
              maxKeywords: 5,
              maxEntities: 5,
              maxDecisions: 5,
              maxRunsPerHour: 999,
              maxShardsPerSession: 1,
              failureBackoffBaseMs: 0,
              failureBackoffMaxMs: 0,
            },
          },
          now: () => 50_000 + call,
          fetchRecentDecryptedRows: async () => rows as any,
          runSummarizer: async () => {
            call += 1;
            return JSON.stringify({
              shard: {
                v: 1,
                seqFrom: 1,
                seqTo: rows.length,
                createdAtFromMs: 1000,
                createdAtToMs: 1000 + rows.length - 1,
                summary: call === 1 ? 'first term' : 'second term',
                keywords: [call === 1 ? 'firstterm' : 'secondterm'],
                entities: [],
                decisions: [],
              },
              synopsis: null,
            });
          },
          commitArtifacts: async () => {},
        });
      };

      await runOnce();
      rows = rows80;
      await runOnce();

      expect(tier1.search({ query: 'firstterm', scope: { type: 'session', sessionId: 'sess-1' }, maxResults: 10 })).toEqual([]);
      expect(tier1.search({ query: 'secondterm', scope: { type: 'session', sessionId: 'sess-1' }, maxResults: 10 }).length).toBe(1);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('applies the configured content policy when building light index shards', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-content-policy-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = [
        {
          seq: 1,
          createdAtMs: 1000,
          role: 'agent' as const,
          content: { type: 'codex', data: { type: 'reasoning', message: 'reasoning-only-memory-sentinel' } },
        },
      ];

      let promptText = '';
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-content-policy'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          contentPolicy: {
            includeUserMessages: true,
            includeAssistantMessages: true,
            includeReasoning: true,
            includeToolSummaries: false,
            includeToolOutputs: false,
          },
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            maxShardChars: 12_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async (prompt) => {
          promptText = prompt;
          return JSON.stringify({
            shard: {
              v: 1,
              seqFrom: 1,
              seqTo: 1,
              createdAtFromMs: 1000,
              createdAtToMs: 1000,
              summary: 'Reasoning content was explicitly included.',
              keywords: ['reasoning'],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          });
        },
        commitArtifacts: async () => {},
      });

      expect(promptText).toContain('reasoning-only-memory-sentinel');

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('honors minShardMessages and targetShardChars without losing the maxShardChars hard cap', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-shard-budgets-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = [
        { seq: 1, createdAtMs: 1000, role: 'user' as const, content: { type: 'text', text: 'a'.repeat(60) } },
        { seq: 2, createdAtMs: 1001, role: 'agent' as const, content: { type: 'text', text: 'b'.repeat(60) } },
        { seq: 3, createdAtMs: 1002, role: 'user' as const, content: { type: 'text', text: 'c'.repeat(60) } },
      ];

      const shardRanges: Array<readonly [number, number]> = [];
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-shard-budgets'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            targetShardMessages: 10,
            minShardMessages: 2,
            targetShardChars: 100,
            maxShardChars: 200,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async (prompt) => {
          const rawWindow = prompt.split('Input window JSON:\n')[1];
          const inputWindow = JSON.parse(rawWindow ?? '{}') as { seqFrom: number; seqTo: number };
          shardRanges.push([inputWindow.seqFrom, inputWindow.seqTo]);
          return JSON.stringify({
            shard: {
              v: 1,
              seqFrom: inputWindow.seqFrom,
              seqTo: inputWindow.seqTo,
              createdAtFromMs: 1000 + inputWindow.seqFrom - 1,
              createdAtToMs: 1000 + inputWindow.seqTo - 1,
              summary: `summary-${inputWindow.seqFrom}-${inputWindow.seqTo}`,
              keywords: [`kw-${inputWindow.seqFrom}-${inputWindow.seqTo}`],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          });
        },
        commitArtifacts: async () => {},
      });

      expect(shardRanges).toEqual([
        [1, 2],
        [3, 3],
      ]);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes full min-sized shard windows to the summarizer even when targetShardMessages is smaller', async () => {
    const { syncMemoryHintsForSessionsOnce } = await import('./syncMemoryHintsForSessionsOnce');

    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-sync-shard-min-window-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const tier1 = openSummaryShardIndexDb({ dbPath });
      tier1.init();

      const rows = [
        { seq: 1, createdAtMs: 1000, role: 'user' as const, content: { type: 'text', text: 'first message' } },
        { seq: 2, createdAtMs: 1001, role: 'agent' as const, content: { type: 'text', text: 'second message' } },
        { seq: 3, createdAtMs: 1002, role: 'user' as const, content: { type: 'text', text: 'third message' } },
      ];

      const shardRanges: Array<readonly [number, number]> = [];
      await syncMemoryHintsForSessionsOnce({
        sessionIds: ['sess-shard-min-window'],
        tier1,
        settings: {
          enabled: true,
          indexMode: 'hints',
          backfillPolicy: 'all_history',
          hints: {
            updateMode: 'continuous',
            idleDelayMs: 0,
            windowSizeMessages: 40,
            targetShardMessages: 1,
            minShardMessages: 2,
            targetShardChars: 1_000,
            maxShardChars: 2_000,
            maxSummaryChars: 500,
            maxKeywords: 5,
            maxEntities: 5,
            maxDecisions: 5,
            maxRunsPerHour: 999,
            maxShardsPerSession: 250,
            failureBackoffBaseMs: 0,
            failureBackoffMaxMs: 0,
          },
        },
        now: () => 5000,
        fetchRecentDecryptedRows: async () => rows as any,
        runSummarizer: async (prompt) => {
          const rawWindow = prompt.split('Input window JSON:\n')[1];
          const inputWindow = JSON.parse(rawWindow ?? '{}') as { seqFrom: number; seqTo: number };
          shardRanges.push([inputWindow.seqFrom, inputWindow.seqTo]);
          return JSON.stringify({
            shard: {
              v: 1,
              seqFrom: inputWindow.seqFrom,
              seqTo: inputWindow.seqTo,
              createdAtFromMs: 1000 + inputWindow.seqFrom - 1,
              createdAtToMs: 1000 + inputWindow.seqTo - 1,
              summary: `summary-${inputWindow.seqFrom}-${inputWindow.seqTo}`,
              keywords: [`kw-${inputWindow.seqFrom}-${inputWindow.seqTo}`],
              entities: [],
              decisions: [],
            },
            synopsis: null,
          });
        },
        commitArtifacts: async () => {},
      });

      expect(shardRanges).toEqual([
        [1, 2],
        [3, 3],
      ]);

      tier1.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
