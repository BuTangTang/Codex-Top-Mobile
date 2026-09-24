/**
 * Provider E2E (G1–G3 / P7.1): Claude Unified TUI runtime-control before a prompt.
 *
 * Drives the REAL Lane C tmux control port + REAL Lane D controller + REAL Lane B outcome contract
 * against the FAKE Claude Unified TUI harness (the tmux process boundary). The settings guard runs
 * against a REAL temp config root so settings isolation (B12) is verified byte-identical in-flow.
 *
 * No internal logic is mocked: the only doubles are the tmux process surface (inside the fake TUI) and
 * the temp `CLAUDE_CONFIG_DIR`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeUnifiedTui, type FakeUnifiedTui } from '../../src/testkit/providers/claude/fakeUnifiedTui';
import { createDrivenTuiController } from '../../src/testkit/providers/claude/unifiedTuiControlDriver';

const SEED_SETTINGS = `${JSON.stringify({ theme: 'dark', verbose: false }, null, 2)}\n`;

describe('Claude Unified TUI runtime control before prompt (G1–G3)', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'happier-tui-control-'));
    writeFileSync(join(configDir, 'settings.json'), SEED_SETTINGS, 'utf8');
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  function readSettings(): string {
    return readFileSync(join(configDir, 'settings.json'), 'utf8');
  }

  /** Emulates Lane E's runner gate: inject the user prompt only when the controls allow it. */
  async function injectPromptIfAllowed(tui: FakeUnifiedTui, promptMayProceed: boolean): Promise<void> {
    if (!promptMayProceed) return;
    await tui.port.sendLiteralText('please do the task');
    await tui.port.sendSpecialKey('Enter');
  }

  it('G1: applies model + effort + permission mode, then allows the prompt', async () => {
    const tui = createFakeUnifiedTui({ persistModelToConfigDir: configDir });
    const controller = createDrivenTuiController({ tui, configDir });

    const outcome = await controller.applyDesiredRuntimeConfig({
      reason: 'before_prompt',
      desired: { model: 'sonnet', reasoningEffort: 'high', permissionMode: 'acceptEdits' },
    });

    expect(outcome.status).toBe('applied');
    expect(outcome.promptMayProceed).toBe(true);

    const byKey = new Map(outcome.changes.map((c) => [c.key, c]));
    expect(byKey.get('model')).toMatchObject({ status: 'applied', effective: 'sonnet' });
    expect(byKey.get('reasoningEffort')).toMatchObject({ status: 'applied', effective: 'high' });
    expect(byKey.get('permissionMode')).toMatchObject({ status: 'applied', effective: 'acceptEdits' });

    // The controls actually mutated the fake provider state.
    expect(tui.getVisibleModel()).toBe('sonnet');
    expect(tui.getVisibleEffort()).toBe('high');
    expect(tui.getMode()).toBe('acceptEdits');

    // Lane C raw ShiftTab encoding flowed through the REAL port (never a named S-Tab).
    expect(tui.commandLog.some((c) => c.kind === 'shiftTab')).toBe(true);
    // `/permissions` is NEVER used as a mode setter (deletion fence B3/B14).
    expect(tui.literalSends.some((t) => t.includes('/permissions'))).toBe(false);
    // Ordering: model command typed before effort command.
    const modelIdx = tui.literalSends.findIndex((t) => t.startsWith('/model'));
    const effortIdx = tui.literalSends.findIndex((t) => t.startsWith('/effort'));
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(effortIdx).toBeGreaterThan(modelIdx);

    // Settings isolation (B12): the persisted model default was reverted byte-identical.
    expect(readSettings()).toBe(SEED_SETTINGS);

    await injectPromptIfAllowed(tui, outcome.promptMayProceed);
    expect(tui.promptWasAccepted()).toBe(true);

    // Provider lifecycle reconciliation records the strongest verification rung.
    controller.reconcileAfterProviderPromptSubmit(tui.emitUserPromptSubmit());
    expect(controller.getLastVerifiedRuntimeConfig()).toMatchObject({
      model: 'sonnet',
      reasoningEffort: 'high',
      modeMarker: 'acceptEdits',
    });

    await controller.dispose();
  });

  it('G1: answers the `Switch model?` confirmation dialog deliberately', async () => {
    const tui = createFakeUnifiedTui({ requireSwitchModelDialog: true, persistModelToConfigDir: configDir });
    const controller = createDrivenTuiController({ tui, configDir });

    const outcome = await controller.applyDesiredRuntimeConfig({
      reason: 'before_prompt',
      desired: { model: 'claude-sonnet-4-6' },
    });

    expect(outcome.status).toBe('applied');
    expect(outcome.promptMayProceed).toBe(true);
    expect(tui.getVisibleModel()).toBe('claude-sonnet-4-6');
    // The dialog was answered with literal `1` (Yes, switch), not by guessing keypress counts.
    expect(tui.literalSends).toContain('1');
    expect(readSettings()).toBe(SEED_SETTINGS);

    await controller.dispose();
  });

  it('G2: a control requested mid-generation is scheduled, not applied, and blocks the prompt; applies before the next prompt', async () => {
    const tui = createFakeUnifiedTui({ persistModelToConfigDir: configDir });
    const controller = createDrivenTuiController({ tui, configDir });

    // Claude is generating: a `/model` typed now would be QUEUED by Claude, never applied (probe P-D).
    tui.beginGeneration();
    const busyOutcome = await controller.applyDesiredRuntimeConfig({
      reason: 'before_prompt',
      desired: { model: 'sonnet' },
    });

    expect(busyOutcome.status).toBe('applied');
    expect(busyOutcome.timing).toBe('next_idle');
    expect(busyOutcome.promptMayProceed).toBe(false);
    // The slash command was NOT typed during generation.
    expect(tui.literalSends.some((t) => t.startsWith('/model'))).toBe(false);
    expect(tui.getVisibleModel()).toBeNull();

    await injectPromptIfAllowed(tui, busyOutcome.promptMayProceed);
    expect(tui.promptWasAccepted()).toBe(false);

    // Generation ends; the scheduled control applies before the next prompt.
    tui.endGeneration();
    const nextOutcome = await controller.applyDesiredRuntimeConfig({ reason: 'before_prompt', desired: {} });

    expect(nextOutcome.status).toBe('applied');
    expect(nextOutcome.promptMayProceed).toBe(true);
    expect(tui.literalSends.some((t) => t.startsWith('/model'))).toBe(true);
    expect(tui.getVisibleModel()).toBe('sonnet');
    expect(readSettings()).toBe(SEED_SETTINGS);

    await injectPromptIfAllowed(tui, nextOutcome.promptMayProceed);
    expect(tui.promptWasAccepted()).toBe(true);

    await controller.dispose();
  });

  it('G3: an unverifiable delivered required control defers, blocks the prompt, and restores settings', async () => {
    const tui = createFakeUnifiedTui({ failModelVerification: true, persistModelToConfigDir: configDir });
    const controller = createDrivenTuiController({ tui, configDir });

    const outcome = await controller.applyDesiredRuntimeConfig({
      reason: 'before_prompt',
      desired: { model: 'sonnet' },
    });

    expect(outcome.status).toBe('applied');
    expect(outcome.promptMayProceed).toBe(false);
    expect(outcome.changes[0]).toMatchObject({
      key: 'model',
      status: 'applied',
      timing: 'queued_until_safe_window',
      reason: 'delivered_unverified',
    });
    expect(tui.getVisibleModel()).toBeNull();
    // Do not send Escape after a delivered command: it may cancel a late-running control.
    expect(tui.commandLog.some((c) => c.kind === 'named' && c.key === 'Escape')).toBe(false);
    // Even on failure the config root is byte-identical.
    expect(readSettings()).toBe(SEED_SETTINGS);

    await injectPromptIfAllowed(tui, outcome.promptMayProceed);
    expect(tui.promptWasAccepted()).toBe(false);

    await controller.dispose();
  });

  it('G3: auto falls back to acceptEdits when auto is absent from the cycle', async () => {
    // `auto` is model/account-gated; with it absent from the cycle the controller converges to the
    // nearest cyclable realization instead of blocking or looping forever.
    const tui = createFakeUnifiedTui({ cycleOrder: ['default', 'acceptEdits', 'plan'] });
    const controller = createDrivenTuiController({ tui, configDir });

    const outcome = await controller.applyDesiredRuntimeConfig({
      reason: 'before_prompt',
      desired: { permissionMode: 'auto' },
    });

    expect(outcome.status).toBe('applied');
    expect(outcome.promptMayProceed).toBe(true);
    expect(outcome.changes[0]).toMatchObject({
      key: 'permissionMode',
      status: 'applied',
      effective: 'acceptEdits',
    });
    expect(tui.getMode()).toBe('acceptEdits');

    await controller.dispose();
  });

  it('G3: a host that died mid-control fails closed and blocks the prompt', async () => {
    const tui = createFakeUnifiedTui();
    const controller = createDrivenTuiController({ tui, configDir });

    tui.killHost();
    const outcome = await controller.applyDesiredRuntimeConfig({
      reason: 'before_prompt',
      desired: { permissionMode: 'acceptEdits' },
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.promptMayProceed).toBe(false);

    await controller.dispose();
  });

  it('heavy-resume non-interactive screens are not treated as a safe control window', async () => {
    const tui = createFakeUnifiedTui({ persistModelToConfigDir: configDir });
    tui.setScreenKind('heavyResumeNonInteractive');
    const controller = createDrivenTuiController({ tui, configDir });

    const outcome = await controller.applyDesiredRuntimeConfig({
      reason: 'before_prompt',
      desired: { model: 'sonnet' },
    });

    // A stable-but-non-interactive resume screen must never be a best-effort write target.
    expect(outcome.status).toBe('failed');
    expect(outcome.promptMayProceed).toBe(false);
    expect(tui.literalSends.some((t) => t.startsWith('/model'))).toBe(false);
    expect(readSettings()).toBe(SEED_SETTINGS);

    await controller.dispose();
  });

  it('injected-but-not-accepted: prompt-gate success is distinct from provider acceptance', async () => {
    const tui = createFakeUnifiedTui();
    tui.setInjectedButNotAccepted(true);
    const controller = createDrivenTuiController({ tui, configDir });

    const outcome = await controller.applyDesiredRuntimeConfig({
      reason: 'before_prompt',
      desired: { permissionMode: 'acceptEdits' },
    });
    expect(outcome.promptMayProceed).toBe(true);

    // The runner may inject the prompt, but the provider never accepted it — bytes delivered != accepted.
    await injectPromptIfAllowed(tui, outcome.promptMayProceed);
    expect(tui.promptWasAccepted()).toBe(false);

    await controller.dispose();
  });

  it('feature gate off: live controls fall back to requires_restart without typing into the TUI', async () => {
    const tui = createFakeUnifiedTui();
    const controller = createDrivenTuiController({ tui, configDir, featureEnabled: false });

    const outcome = await controller.applyDesiredRuntimeConfig({
      reason: 'before_prompt',
      desired: { model: 'sonnet', permissionMode: 'acceptEdits' },
    });

    expect(outcome.status).toBe('requires_restart');
    // Restart-notice path is non-blocking (existing behavior); no control bytes were sent.
    expect(outcome.promptMayProceed).toBe(true);
    expect(tui.literalSends.length).toBe(0);
    expect(tui.commandLog.length).toBe(0);

    await controller.dispose();
  });
});
