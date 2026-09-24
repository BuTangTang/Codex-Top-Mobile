import { describe, expect, it } from 'vitest';

import {
  ensureRemoteStartingModeArgs,
  ensureUnifiedTerminalStartingModeArgs,
  HAPPY_STARTING_MODE_REMOTE,
  HAPPY_STARTING_MODE_UNIFIED,
} from './headlessTmuxArgs';

describe('ensureRemoteStartingModeArgs', () => {
  it('appends remote mode when not present', () => {
    expect(ensureRemoteStartingModeArgs(['--foo'])).toEqual([
      '--foo',
      '--happy-starting-mode',
      'remote',
    ]);
  });

  it('keeps explicit remote mode', () => {
    expect(ensureRemoteStartingModeArgs(['--happy-starting-mode', 'remote'])).toEqual([
      '--happy-starting-mode',
      'remote',
    ]);
  });

  it('throws when local mode is requested', () => {
    expect(() => ensureRemoteStartingModeArgs(['--happy-starting-mode', 'local'])).toThrow(
      'Headless tmux sessions require remote mode',
    );
  });

  it('fails closed when any duplicate --happy-starting-mode value is local', () => {
    expect(() =>
      ensureRemoteStartingModeArgs([
        '--happy-starting-mode',
        'remote',
        '--happy-starting-mode',
        'local',
      ]),
    ).toThrow('Headless tmux sessions require remote mode');
  });

  it('throws a helpful error when --happy-starting-mode is missing a value', () => {
    expect(() => ensureRemoteStartingModeArgs(['--happy-starting-mode'])).toThrow(/--happy-starting-mode/);
  });
});

describe('ensureUnifiedTerminalStartingModeArgs', () => {
  it('exports stable starting-mode constants', () => {
    expect(HAPPY_STARTING_MODE_REMOTE).toBe('remote');
    expect(HAPPY_STARTING_MODE_UNIFIED).toBe('unified');
  });

  it('appends unified mode when not present', () => {
    expect(ensureUnifiedTerminalStartingModeArgs(['--foo'])).toEqual([
      '--foo',
      '--happy-starting-mode',
      HAPPY_STARTING_MODE_UNIFIED,
    ]);
  });

  it('keeps explicit unified mode', () => {
    expect(ensureUnifiedTerminalStartingModeArgs(['--happy-starting-mode', 'unified'])).toEqual([
      '--happy-starting-mode',
      'unified',
    ]);
  });

  it('rejects duplicate conflicting starting modes', () => {
    expect(() =>
      ensureUnifiedTerminalStartingModeArgs([
        '--happy-starting-mode',
        'unified',
        '--happy-starting-mode',
        'remote',
      ]),
    ).toThrow('Headless tmux unified sessions require unified starting mode');
  });

  it('does not broaden remote-mode validation to accept unified', () => {
    expect(() => ensureRemoteStartingModeArgs(['--happy-starting-mode', 'unified'])).toThrow(
      'Headless tmux sessions require remote mode',
    );
  });
});
