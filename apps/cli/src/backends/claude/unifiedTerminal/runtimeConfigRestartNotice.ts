import type { EnhancedMode } from '../loop';
import { resolveClaudeSdkPermissionModeFromEnhancedMode } from '../utils/permissionMode';

/**
 * Canonical "runtime config changed but cannot apply live" comparator + notices, shared by the
 * daemon launcher (`claudeRemoteLauncher`) and the standalone unified-terminal launcher.
 *
 * QA-B B6 (live 2026-06-12, session cmqawdqzj): with the TUI runtime-control gate OFF, the
 * standalone launcher had NO restart-only notice path at all — a permission-mode/model change
 * between turns was silently dropped (the prompt ran under the stale config with no transcript
 * notice), while the daemon launcher surfaced the legacy `requires_restart` notice.
 */

export const CLAUDE_UNIFIED_TERMINAL_RESTART_ONLY_OPTIONS_MESSAGE =
  'Claude unified terminal is already running. Model, permission, reasoning, and launch option changes apply when Claude restarts; this prompt was sent to the current Claude terminal session.';
export const CLAUDE_UNIFIED_TERMINAL_UNSUPPORTED_OPTIONS_MESSAGE =
  'Claude unified terminal does not support max thinking token overrides; this prompt was sent without applying that option.';

export type RuntimeConfigOutcomeScalar = string | number | boolean | null;

export type ClaudeRuntimeConfigOutcomeChange = Readonly<{
  key: 'model' | 'fallbackModel' | 'permissionMode' | 'reasoningEffort' | 'maxThinkingTokens' | 'launchOption';
  requested?: RuntimeConfigOutcomeScalar;
  previous?: RuntimeConfigOutcomeScalar;
  effective?: RuntimeConfigOutcomeScalar;
  reason?: string;
}>;

export function normalizeRuntimeConfigOutcomeScalar(value: unknown): RuntimeConfigOutcomeScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return String(value);
}

function pushRuntimeConfigOutcomeChange(
  changes: ClaudeRuntimeConfigOutcomeChange[],
  key: ClaudeRuntimeConfigOutcomeChange['key'],
  previous: unknown,
  requested: unknown,
  reason?: string,
): void {
  const previousValue = normalizeRuntimeConfigOutcomeScalar(previous);
  const requestedValue = normalizeRuntimeConfigOutcomeScalar(requested);
  if (Object.is(previousValue, requestedValue)) return;
  changes.push({
    key,
    previous: previousValue,
    requested: requestedValue,
    ...(reason ? { reason } : {}),
  });
}

export function buildUnifiedTerminalRuntimeConfigRestartChanges(
  currentMode: EnhancedMode | null,
  nextMode: EnhancedMode,
): ClaudeRuntimeConfigOutcomeChange[] {
  const changes: ClaudeRuntimeConfigOutcomeChange[] = [];
  if (!currentMode) {
    changes.push({ key: 'launchOption', reason: 'no_current_mode_snapshot' });
    return changes;
  }

  pushRuntimeConfigOutcomeChange(changes, 'model', currentMode.model, nextMode.model);
  pushRuntimeConfigOutcomeChange(changes, 'fallbackModel', currentMode.fallbackModel, nextMode.fallbackModel);
  // Compare the EFFECTIVE Claude permission mode: plan-mode rides agentModeId, so a plan toggle with
  // an unchanged raw permissionMode must still register as a permissionMode-class change (the TUI
  // controller live-applies it) instead of falling through to the unclassified launch-option notice.
  pushRuntimeConfigOutcomeChange(
    changes,
    'permissionMode',
    resolveClaudeSdkPermissionModeFromEnhancedMode(currentMode),
    resolveClaudeSdkPermissionModeFromEnhancedMode(nextMode),
  );
  pushRuntimeConfigOutcomeChange(changes, 'reasoningEffort', currentMode.reasoningEffort, nextMode.reasoningEffort);
  pushRuntimeConfigOutcomeChange(
    changes,
    'maxThinkingTokens',
    currentMode.claudeRemoteMaxThinkingTokens,
    nextMode.claudeRemoteMaxThinkingTokens,
    'unsupported_by_claude_unified_terminal',
  );
  pushRuntimeConfigOutcomeChange(
    changes,
    'launchOption',
    currentMode.claudeUnifiedTerminalHost ?? 'auto',
    nextMode.claudeUnifiedTerminalHost ?? 'auto',
    'claudeUnifiedTerminalHost',
  );
  pushRuntimeConfigOutcomeChange(
    changes,
    'launchOption',
    currentMode.claudeUnifiedTerminalResumeChoice ?? 'ask_every_time',
    nextMode.claudeUnifiedTerminalResumeChoice ?? 'ask_every_time',
    'claudeUnifiedTerminalResumeChoice',
  );
  pushRuntimeConfigOutcomeChange(
    changes,
    'launchOption',
    currentMode.ultracode === true,
    nextMode.ultracode === true,
    'ultracode',
  );

  return changes;
}

export type GateOffRestartNoticeEmission = Readonly<{
  status: 'requires_restart' | 'unsupported';
  reason: string;
  message: string;
  changes: readonly ClaudeRuntimeConfigOutcomeChange[];
}>;

/**
 * Gate-OFF legacy notice tracker for the STANDALONE unified-terminal launcher: observes the mode
 * of each batch handed to the runner and emits the honest legacy notices when controller-class
 * config changed between batches but no runtime-control bridge exists to apply it. One emission
 * per distinct change signature (re-deliveries of the same stale delta stay silent).
 */
export function createUnifiedTerminalGateOffRestartNoticeTracker(params: Readonly<{
  emit: (emission: GateOffRestartNoticeEmission) => void;
}>): Readonly<{ observeBatchMode: (mode: EnhancedMode) => void }> {
  let lastMode: EnhancedMode | null = null;
  let lastEmittedSignature: string | null = null;

  return {
    observeBatchMode(mode: EnhancedMode): void {
      const previous = lastMode;
      lastMode = mode;
      // The first batch establishes the baseline; there is nothing to compare against.
      if (!previous) return;
      const changes = buildUnifiedTerminalRuntimeConfigRestartChanges(previous, mode);
      if (changes.length === 0) {
        lastEmittedSignature = null;
        return;
      }
      const signature = JSON.stringify(changes.map((change) => [change.key, change.previous ?? null, change.requested ?? null]));
      if (signature === lastEmittedSignature) return;
      lastEmittedSignature = signature;

      const unsupportedChanges = changes.filter((change) => change.key === 'maxThinkingTokens');
      const restartChanges = changes.filter((change) => change.key !== 'maxThinkingTokens');
      if (restartChanges.length > 0) {
        params.emit({
          status: 'requires_restart',
          reason: 'unified_terminal_launch_options_changed',
          message: CLAUDE_UNIFIED_TERMINAL_RESTART_ONLY_OPTIONS_MESSAGE,
          changes: restartChanges,
        });
      }
      if (unsupportedChanges.length > 0) {
        params.emit({
          status: 'unsupported',
          reason: 'unified_terminal_unsupported_options_changed',
          message: CLAUDE_UNIFIED_TERMINAL_UNSUPPORTED_OPTIONS_MESSAGE,
          changes: unsupportedChanges,
        });
      }
    },
  };
}
