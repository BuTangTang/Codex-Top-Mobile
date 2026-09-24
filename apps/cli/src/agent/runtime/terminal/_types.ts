import type { DrainPendingOptions, DrainPendingResult, MessageBatch } from '@/agent/runtime/sessionInput/types';
import type {
  TerminalHostKind,
  TerminalInjectionDuplicateRisk,
  TerminalInjectionFailurePhase,
  TerminalInputInjectionResult,
  TerminalPromptInput,
} from '@happier-dev/agents';

export type {
  TerminalHostKind,
  TerminalInjectionDuplicateRisk,
  TerminalInjectionFailurePhase,
  TerminalInputInjectionResult,
  TerminalPromptInput,
};

export type TerminalTurnState = 'idle' | 'running' | 'finalizing' | 'blocked_on_permission' | 'unknown';

export type TerminalLifecycleObservation =
  | Readonly<{ type: 'turn_state'; state: TerminalTurnState; observedAtMs?: number }>
  | Readonly<{ type: 'permission'; blocked: boolean; observedAtMs?: number }>
  | Readonly<{ type: 'compaction'; phase: 'started' | 'completed'; observedAtMs?: number }>
  | Readonly<{ type: 'output'; observedAtMs?: number }>;

export type TerminalHostLiveness = Readonly<{
  paneAlive: boolean;
  probeInconclusive?: boolean | undefined;
  paneDead?: boolean | undefined;
  panePid?: number | undefined;
  paneCurrentCommand?: string | undefined;
  paneExitStatus?: number | undefined;
  observedAt: number;
}>;

export type TerminalInputConsumer<Mode, Message> = Readonly<{
  waitForNextInput: (opts: { abortSignal: AbortSignal }) => Promise<MessageBatch<Mode, Message> | null>;
  drainPending?: ((opts?: DrainPendingOptions) => Promise<DrainPendingResult>) | undefined;
}>;
