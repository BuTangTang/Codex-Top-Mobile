export type TurnAssistantTextSnapshotSource = 'ephemeral' | 'committed' | 'transcript';

export type TurnAssistantTextSnapshot = Readonly<{
  turnToken: string;
  text: string;
  observedAtMs: number;
  seq: number | null;
  localId: string | null;
  sidechainId: string | null;
  provider: string | null;
  source: TurnAssistantTextSnapshotSource;
}>;

export type TurnAssistantTextCandidate = Readonly<{
  turnToken?: string | null;
  text: string | null | undefined;
  observedAtMs?: number;
  seq?: number | null;
  localId?: string | null;
  sidechainId?: string | null;
  provider?: string | null;
  source: TurnAssistantTextSnapshotSource;
}>;

export type TurnAssistantTextSnapshotStore = Readonly<{
  beginTurn: (params?: {
    turnToken?: string;
    startSeqExclusive?: number | null;
    startedAtMs?: number;
  }) => string;
  observe: (candidate: TurnAssistantTextCandidate) => void;
  getForTurn: (params: {
    turnToken?: string | null;
    startSeqExclusive?: number | null;
  }) => TurnAssistantTextSnapshot | null;
  getActive: () => TurnAssistantTextSnapshot | null;
  resetActive: (turnToken?: string | null) => void;
}>;
