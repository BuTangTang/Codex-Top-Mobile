import { SessionSummaryShardV1Schema, type SessionSummaryShardV1 } from '@happier-dev/protocol';

import type { DecryptedTranscriptRow } from '@/session/replay/decryptTranscriptRows';

import { buildMemorySummaryShardSystemRecordLocalId } from './memorySystemRecords';

function readLegacyHappierMeta(meta: unknown): Readonly<{ kind: string; payload: unknown }> | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const happier = (meta as Record<string, unknown>).happier;
  if (!happier || typeof happier !== 'object' || Array.isArray(happier)) return null;
  const kind = (happier as Record<string, unknown>).kind;
  if (typeof kind !== 'string') return null;
  return {
    kind,
    payload: (happier as Record<string, unknown>).payload,
  };
}

export function extractLegacySummaryShardTranscriptArtifacts(rows: ReadonlyArray<DecryptedTranscriptRow>): SessionSummaryShardV1[] {
  const out: SessionSummaryShardV1[] = [];
  const seenLocalIds = new Set<string>();
  for (const row of rows) {
    const meta = readLegacyHappierMeta(row.meta);
    if (!meta || meta.kind !== 'session_summary_shard.v1') continue;
    const parsed = SessionSummaryShardV1Schema.safeParse(meta.payload);
    if (!parsed.success) continue;
    const localId = buildMemorySummaryShardSystemRecordLocalId({
      seqFrom: parsed.data.seqFrom,
      seqTo: parsed.data.seqTo,
    });
    if (seenLocalIds.has(localId)) continue;
    seenLocalIds.add(localId);
    out.push(parsed.data);
  }
  return out;
}
