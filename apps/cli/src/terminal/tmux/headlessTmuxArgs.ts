export const HAPPY_STARTING_MODE_REMOTE = 'remote';
export const HAPPY_STARTING_MODE_UNIFIED = 'unified';

const STARTING_MODE_FLAG = '--happy-starting-mode';

function findStartingModeFlagIndexes(argv: readonly string[]): number[] {
  const modeFlagIndexes: number[] = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === STARTING_MODE_FLAG) {
      modeFlagIndexes.push(index);
    }
  }
  return modeFlagIndexes;
}

export function ensureRemoteStartingModeArgs(argv: string[]): string[] {
  const modeFlagIndexes = findStartingModeFlagIndexes(argv);

  if (modeFlagIndexes.length === 0) {
    return [...argv, STARTING_MODE_FLAG, HAPPY_STARTING_MODE_REMOTE];
  }

  for (const index of modeFlagIndexes) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('Missing value for --happy-starting-mode (expected "remote" or "local")');
    }
    if (value === HAPPY_STARTING_MODE_REMOTE) continue;
    if (value === 'local') {
      throw new Error('Headless tmux sessions require remote mode');
    }

    // Unknown value: preserve but keep behavior consistent by failing closed.
    throw new Error('Headless tmux sessions require remote mode');
  }

  return argv;
}

export function ensureUnifiedTerminalStartingModeArgs(argv: string[]): string[] {
  const modeFlagIndexes = findStartingModeFlagIndexes(argv);

  if (modeFlagIndexes.length === 0) {
    return [...argv, STARTING_MODE_FLAG, HAPPY_STARTING_MODE_UNIFIED];
  }

  for (const index of modeFlagIndexes) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('Missing value for --happy-starting-mode (expected "unified")');
    }
    if (value === HAPPY_STARTING_MODE_UNIFIED) continue;
    throw new Error('Headless tmux unified sessions require unified starting mode');
  }

  return argv;
}
