import os from 'node:os';
import path from 'node:path';

import { resolveHappyHomeDirFromEnvironment } from '@happier-dev/cli-common/providers';

import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

function normalizeEnvPath(value: string | undefined, env: NodeJS.ProcessEnv): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return expandHomeDirPath(trimmed, env);
}

function assertFilesystemSafeStackName(raw: string): string {
  const stack = raw.trim();
  if (!stack) {
    throw new Error('Invalid stack name: empty');
  }
  if (stack === '.' || stack === '..') {
    throw new Error(`Invalid stack name: ${stack}`);
  }
  // Prevent directory traversal (path.join treats separators as path segments).
  if (stack.includes('/') || stack.includes('\\')) {
    throw new Error(`Invalid stack name: ${stack}`);
  }
  return stack;
}

export function resolveStackToolTraceDir(params: {
  stack: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const stack = assertFilesystemSafeStackName(params.stack);
  const env = params.env ?? process.env;

  const storageOverride = normalizeEnvPath(env.HAPPIER_STACK_STORAGE_DIR, env);
  const stacksRoot = storageOverride ?? path.join(resolveHappyHomeDirFromEnvironment(env) || os.homedir(), 'stacks');

  return path.join(stacksRoot, stack, 'cli', 'tool-traces');
}
