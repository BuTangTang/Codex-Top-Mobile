import { randomUUID } from 'node:crypto';

import { normalizeTurnAssistantText } from './normalizeTurnAssistantText';
import type {
  TurnAssistantTextCandidate,
  TurnAssistantTextSnapshot,
  TurnAssistantTextSnapshotSource,
  TurnAssistantTextSnapshotStore,
} from './types';

type ActiveTurn = Readonly<{
  turnToken: string;
  startSeqExclusive: number | null;
  startedAtMs: number;
}>;

const SOURCE_PRIORITY: Record<TurnAssistantTextSnapshotSource, number> = {
  ephemeral: 1,
  transcript: 2,
  committed: 3,
};

function normalizeSeq(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shouldReplaceSnapshot(
  current: TurnAssistantTextSnapshot | null,
  next: TurnAssistantTextSnapshot,
): boolean {
  if (!current) return true;
  const currentPriority = SOURCE_PRIORITY[current.source];
  const nextPriority = SOURCE_PRIORITY[next.source];
  if (nextPriority !== currentPriority) return nextPriority > currentPriority;
  if (next.seq !== null && current.seq !== null && next.seq !== current.seq) return next.seq > current.seq;
  if (next.seq !== null && current.seq === null) return true;
  return next.observedAtMs >= current.observedAtMs;
}

export function createTurnAssistantTextSnapshotStore(params: Readonly<{
  maxTextChars: number;
}>): TurnAssistantTextSnapshotStore {
  let activeTurn: ActiveTurn | null = null;
  let activeSnapshot: TurnAssistantTextSnapshot | null = null;

  const getTurnTokenForCandidate = (candidate: TurnAssistantTextCandidate): string | null => {
    const explicit = normalizeNullableString(candidate.turnToken);
    if (explicit) return explicit;
    return activeTurn?.turnToken ?? null;
  };

  return {
    beginTurn(beginParams = {}) {
      const turnToken = normalizeNullableString(beginParams.turnToken) ?? randomUUID();
      activeTurn = {
        turnToken,
        startSeqExclusive: normalizeSeq(beginParams.startSeqExclusive),
        startedAtMs:
          typeof beginParams.startedAtMs === 'number' && Number.isFinite(beginParams.startedAtMs)
            ? Math.max(0, Math.trunc(beginParams.startedAtMs))
            : Date.now(),
      };
      activeSnapshot = null;
      return turnToken;
    },

    observe(candidate) {
      const turnToken = getTurnTokenForCandidate(candidate);
      if (!turnToken) return;
      if (activeTurn && turnToken !== activeTurn.turnToken) return;
      const sidechainId = normalizeNullableString(candidate.sidechainId);
      if (sidechainId !== null) return;
      const text = normalizeTurnAssistantText(candidate.text, { maxTextChars: params.maxTextChars });
      if (!text) return;
      const seq = normalizeSeq(candidate.seq);
      const startSeqExclusive = activeTurn?.startSeqExclusive ?? null;
      if (seq !== null && startSeqExclusive !== null && seq <= startSeqExclusive) return;
      const snapshot: TurnAssistantTextSnapshot = {
        turnToken,
        text,
        observedAtMs:
          typeof candidate.observedAtMs === 'number' && Number.isFinite(candidate.observedAtMs)
            ? Math.max(0, Math.trunc(candidate.observedAtMs))
            : Date.now(),
        seq,
        localId: normalizeNullableString(candidate.localId),
        sidechainId: null,
        provider: normalizeNullableString(candidate.provider),
        source: candidate.source,
      };
      if (shouldReplaceSnapshot(activeSnapshot, snapshot)) {
        activeSnapshot = snapshot;
      }
    },

    getForTurn(getParams) {
      const turnToken = normalizeNullableString(getParams.turnToken);
      if (!turnToken || !activeSnapshot || activeSnapshot.turnToken !== turnToken) return null;
      const startSeqExclusive = normalizeSeq(getParams.startSeqExclusive);
      if (
        activeSnapshot.seq !== null
        && startSeqExclusive !== null
        && activeSnapshot.seq <= startSeqExclusive
      ) {
        return null;
      }
      return activeSnapshot;
    },

    getActive() {
      return activeSnapshot;
    },

    resetActive(turnToken) {
      const normalizedToken = normalizeNullableString(turnToken);
      if (normalizedToken && activeTurn?.turnToken !== normalizedToken) return;
      activeTurn = null;
      activeSnapshot = null;
    },
  };
}
