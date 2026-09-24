import {
  createClaudeSettingsGuard,
  createClaudeUnifiedTuiControlController,
  type ClaudeUnifiedTuiControlController,
} from '@/backends/claude/unifiedTerminal/tuiControls';

import type { FakeUnifiedTui } from './fakeUnifiedTui';

/**
 * Wires the REAL Lane D runtime-control controller and the REAL Lane D settings guard to a
 * {@link FakeUnifiedTui}'s REAL Lane C terminal-control port. Nothing here is a double except the
 * tmux process boundary inside the fake TUI and the `configDir` (a real temp dir the test owns).
 *
 * `wait` is a no-op resolve so settle delays cost no wall-clock time — the fake screen is stateful, so
 * every recapture reflects the current state without needing real timers (deterministic, no flake).
 */
export function createDrivenTuiController(params: Readonly<{
  tui: FakeUnifiedTui;
  /** Real temp config root the settings guard snapshots/restores around `/model` and `/effort`. */
  configDir: string;
  /** Feature-gate decision (B15). Default true (controller active). */
  featureEnabled?: boolean;
  maxModeCycleAttempts?: number;
}>): ClaudeUnifiedTuiControlController {
  const settingsGuard = createClaudeSettingsGuard({
    configDir: params.configDir,
    wait: () => Promise.resolve(),
  });
  return createClaudeUnifiedTuiControlController({
    port: params.tui.port,
    featureEnabled: params.featureEnabled ?? true,
    settingsGuard,
    wait: () => Promise.resolve(),
    maxModeCycleAttempts: params.maxModeCycleAttempts,
  });
}
