import { describe, expect, it } from 'vitest';

import { resolveTerminalInjectionReadiness, TERMINAL_INPUT_MAX_WAIT_MS, TERMINAL_INPUT_QUIET_PERIOD_MS } from './arbiter';

describe('resolveTerminalInjectionReadiness', () => {
  it('allows injection during a running turn when the input surface is quiet', () => {
    expect(
      resolveTerminalInjectionReadiness({
        nowMs: 2_000,
        lastOutputAtMs: 1_000,
        firstObservedAtMs: 0,
        outputObserved: true,
        permissionBlocked: false,
        turnState: 'running',
        userTyping: false,
      }),
    ).toEqual({ ready: true });
  });

  it('defers during terminal turn finalization even when the input surface is quiet', () => {
    expect(
      resolveTerminalInjectionReadiness({
        nowMs: 2_000,
        lastOutputAtMs: 1_000,
        firstObservedAtMs: 0,
        outputObserved: true,
        permissionBlocked: false,
        turnState: 'finalizing',
        userTyping: false,
      }),
    ).toEqual({ ready: false, reason: 'pane_initializing' });
  });

  it('defers while the terminal user is typing', () => {
    expect(
      resolveTerminalInjectionReadiness({
        nowMs: 2_000,
        lastOutputAtMs: 1_000,
        firstObservedAtMs: 0,
        outputObserved: true,
        permissionBlocked: false,
        turnState: 'idle',
        userTyping: true,
      }),
    ).toEqual({ ready: false, reason: 'user_typing', retryAfterMs: TERMINAL_INPUT_MAX_WAIT_MS - 2_000 });
  });

  it('waits for an output quiet window before injecting', () => {
    expect(
      resolveTerminalInjectionReadiness({
        nowMs: 1_000 + TERMINAL_INPUT_QUIET_PERIOD_MS - 1,
        lastOutputAtMs: 1_000,
        firstObservedAtMs: 0,
        outputObserved: true,
        permissionBlocked: false,
        turnState: 'idle',
        userTyping: false,
      }),
    ).toEqual({
      ready: false,
      reason: 'pane_initializing',
      retryAfterMs: 1,
    });
  });

  it('fails closed after the maximum wait with no output', () => {
    expect(
      resolveTerminalInjectionReadiness({
        nowMs: TERMINAL_INPUT_MAX_WAIT_MS + 1,
        lastOutputAtMs: null,
        firstObservedAtMs: 0,
        outputObserved: false,
        permissionBlocked: false,
        turnState: 'idle',
        userTyping: false,
      }),
    ).toEqual({ ready: false, reason: 'timeout' });
  });

  it('allows injection after quiet idle output', () => {
    expect(
      resolveTerminalInjectionReadiness({
        nowMs: 1_000 + TERMINAL_INPUT_QUIET_PERIOD_MS,
        lastOutputAtMs: 1_000,
        firstObservedAtMs: 0,
        outputObserved: true,
        permissionBlocked: false,
        turnState: 'idle',
        userTyping: false,
      }),
    ).toEqual({ ready: true });
  });
});
