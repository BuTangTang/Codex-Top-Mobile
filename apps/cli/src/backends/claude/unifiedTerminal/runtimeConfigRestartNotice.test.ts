import { describe, expect, it } from 'vitest';

import type { EnhancedMode } from '../loop';
import {
  buildUnifiedTerminalRuntimeConfigRestartChanges,
  createUnifiedTerminalGateOffRestartNoticeTracker,
  type GateOffRestartNoticeEmission,
} from './runtimeConfigRestartNotice';

const baseMode: EnhancedMode = {
  permissionMode: 'safe-yolo',
  model: 'claude-haiku-4-5',
  claudeUnifiedTerminalEnabled: true,
};

function trackerWithLog() {
  const emissions: GateOffRestartNoticeEmission[] = [];
  const tracker = createUnifiedTerminalGateOffRestartNoticeTracker({
    emit: (emission) => emissions.push(emission),
  });
  return { tracker, emissions };
}

// QA-B B6 (live 2026-06-12, session cmqawdqzj): with the runtime-control gate OFF the standalone
// launcher silently dropped a permission-mode change between turns — no requires_restart notice,
// prompt ran under the stale mode. The daemon launcher already surfaced the legacy notice.
describe('createUnifiedTerminalGateOffRestartNoticeTracker (B6 gate-off legacy notices)', () => {
  it('emits ONE requires_restart notice when a controller-class change arrives between batches', () => {
    const { tracker, emissions } = trackerWithLog();
    tracker.observeBatchMode(baseMode);
    tracker.observeBatchMode({ ...baseMode, permissionMode: 'plan' });

    expect(emissions).toHaveLength(1);
    expect(emissions[0]).toMatchObject({ status: 'requires_restart', reason: 'unified_terminal_launch_options_changed' });
    expect(emissions[0].changes.map((c) => c.key)).toEqual(['permissionMode']);
  });

  it('does not emit on the first batch (baseline) or when nothing changed', () => {
    const { tracker, emissions } = trackerWithLog();
    tracker.observeBatchMode(baseMode);
    tracker.observeBatchMode({ ...baseMode });
    expect(emissions).toHaveLength(0);
  });

  it('dedups repeated deliveries of the SAME stale delta but re-emits a new delta', () => {
    const { tracker, emissions } = trackerWithLog();
    tracker.observeBatchMode(baseMode);
    tracker.observeBatchMode({ ...baseMode, model: 'claude-sonnet-4-5' });
    // Same changed mode again: previous batch already had sonnet → no delta → silence.
    tracker.observeBatchMode({ ...baseMode, model: 'claude-sonnet-4-5' });
    tracker.observeBatchMode({ ...baseMode, model: 'claude-haiku-4-5' });

    expect(emissions).toHaveLength(2);
    expect(emissions[0].changes[0]).toMatchObject({ key: 'model', requested: 'claude-sonnet-4-5' });
    expect(emissions[1].changes[0]).toMatchObject({ key: 'model', requested: 'claude-haiku-4-5' });
  });

  it('routes maxThinkingTokens to the unsupported notice, separate from restart-only changes', () => {
    const { tracker, emissions } = trackerWithLog();
    tracker.observeBatchMode(baseMode);
    tracker.observeBatchMode({ ...baseMode, permissionMode: 'plan', claudeRemoteMaxThinkingTokens: 2048 });

    expect(emissions.map((e) => e.status).sort()).toEqual(['requires_restart', 'unsupported']);
    const unsupported = emissions.find((e) => e.status === 'unsupported');
    expect(unsupported?.changes[0]).toMatchObject({ key: 'maxThinkingTokens', requested: 2048 });
  });
});

describe('buildUnifiedTerminalRuntimeConfigRestartChanges (shared comparator)', () => {
  it('reports an unclassified launch-option change when there is no current mode snapshot', () => {
    const changes = buildUnifiedTerminalRuntimeConfigRestartChanges(null, baseMode);
    expect(changes).toEqual([{ key: 'launchOption', reason: 'no_current_mode_snapshot' }]);
  });

  it('detects effective permission-mode changes when plan rides agentModeId only', () => {
    const changes = buildUnifiedTerminalRuntimeConfigRestartChanges(
      { ...baseMode, permissionMode: 'default' },
      { ...baseMode, permissionMode: 'default', agentModeId: 'plan' },
    );
    expect(changes.map((c) => c.key)).toContain('permissionMode');
  });

  it('reports resume-choice changes as launch-option restart reasons', () => {
    const changes = buildUnifiedTerminalRuntimeConfigRestartChanges(
      { ...baseMode, claudeUnifiedTerminalResumeChoice: 'ask_every_time' },
      { ...baseMode, claudeUnifiedTerminalResumeChoice: 'resume_from_summary' },
    );

    expect(changes).toContainEqual({
      key: 'launchOption',
      previous: 'ask_every_time',
      requested: 'resume_from_summary',
      reason: 'claudeUnifiedTerminalResumeChoice',
    });
  });
});
