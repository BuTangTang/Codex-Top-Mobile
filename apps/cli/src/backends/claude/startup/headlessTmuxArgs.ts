import {
  ensureRemoteStartingModeArgs,
  ensureUnifiedTerminalStartingModeArgs,
  HAPPY_STARTING_MODE_UNIFIED,
} from '@/terminal/tmux/headlessTmuxArgs';

const STARTING_MODE_FLAG = '--happy-starting-mode';

function hasExplicitUnifiedStartingMode(argv: readonly string[]): boolean {
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === STARTING_MODE_FLAG && argv[index + 1] === HAPPY_STARTING_MODE_UNIFIED) {
      return true;
    }
  }
  return false;
}

export function ensureClaudeHeadlessTmuxStartingModeArgs(argv: string[]): string[] {
  if (hasExplicitUnifiedStartingMode(argv)) {
    return ensureUnifiedTerminalStartingModeArgs(argv);
  }
  return ensureRemoteStartingModeArgs(argv);
}
