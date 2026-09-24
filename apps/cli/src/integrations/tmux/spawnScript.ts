import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  buildPosixShellCommand,
  buildPosixShellEnvironmentAssignments,
} from '@/utils/posixShellCommand';

import { readPositiveIntegerEnv } from './env';

const DEFAULT_INLINE_SPAWN_MAX_CHARS = 24_000;
const INLINE_SPAWN_MAX_CHARS_ENV = 'HAPPIER_CLI_TMUX_INLINE_SPAWN_MAX_CHARS';

export function resolveTmuxInlineSpawnMaxChars(): number {
  return readPositiveIntegerEnv(INLINE_SPAWN_MAX_CHARS_ENV, DEFAULT_INLINE_SPAWN_MAX_CHARS);
}

export function measureTmuxCommandArgsLength(args: readonly string[]): number {
  return args.reduce((total, arg) => total + Buffer.byteLength(arg, 'utf8') + 1, 0);
}

export function buildTmuxSpawnScriptCommand(scriptPath: string): string {
  return buildPosixShellCommand(['/bin/sh', scriptPath]);
}

export async function writeTmuxSpawnScript(
  command: string,
  env: Readonly<Record<string, string>>,
): Promise<string> {
  const scriptDir = await mkdtemp(join(tmpdir(), 'happier-tmux-spawn-'));
  await chmod(scriptDir, 0o700);
  const scriptPath = join(scriptDir, 'spawn.sh');
  const envAssignments = buildPosixShellEnvironmentAssignments(env);
  const exportLine = envAssignments.length > 0 ? `export ${envAssignments}\n` : '';
  const script = [
    '#!/bin/sh',
    'script_dir=${0%/*}',
    'rm -f "$0"',
    'rmdir "$script_dir" 2>/dev/null || true',
    exportLine.trimEnd(),
    `exec ${command}`,
    '',
  ].filter((line) => line.length > 0).join('\n');

  await writeFile(scriptPath, script, { mode: 0o600 });
  await chmod(scriptPath, 0o600);
  return scriptPath;
}

export async function removeTmuxSpawnScript(scriptPath: string): Promise<void> {
  await rm(dirname(scriptPath), { force: true, recursive: true });
}
