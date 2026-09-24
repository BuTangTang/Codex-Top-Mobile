import { homedir as osHomedir } from 'node:os';
import { posix, win32 } from 'node:path';

import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

export const MACHINE_RPC_WORKING_DIRECTORY_ENV = 'HAPPIER_MACHINE_RPC_WORKING_DIRECTORY';

export type FilesystemAccessPolicy =
  | Readonly<{ kind: 'osUser' }>
  | Readonly<{ kind: 'restrictedRoots'; roots: readonly string[] }>;

export function resolveFilesystemPolicyDefaultDirectory(input: Readonly<{
  defaultDirectory: string;
  accessPolicy: FilesystemAccessPolicy;
}>): string {
  if (input.accessPolicy.kind === 'restrictedRoots' && input.accessPolicy.roots.length > 0) {
    return input.accessPolicy.roots[0];
  }
  return input.defaultDirectory;
}

export function resolveFilesystemPolicyProtectedRoots(input: Readonly<{
  defaultDirectory: string;
  accessPolicy: FilesystemAccessPolicy;
}>): readonly string[] {
  if (input.accessPolicy.kind === 'restrictedRoots' && input.accessPolicy.roots.length > 0) {
    return input.accessPolicy.roots;
  }
  return [input.defaultDirectory];
}

export class FilesystemAccessPolicyConfigurationError extends Error {
  readonly invalidRoots: readonly string[];

  constructor(message: string, invalidRoots: readonly string[]) {
    super(message);
    this.name = 'FilesystemAccessPolicyConfigurationError';
    this.invalidRoots = invalidRoots;
  }
}

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

export function isFilesystemPathAbsolute(pathValue: string, platform: NodeJS.Platform = process.platform): boolean {
  return pathApi(platform).isAbsolute(pathValue);
}

export function normalizeFilesystemPathForPolicy(
  pathValue: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const api = pathApi(platform);
  return api.normalize(api.resolve(pathValue));
}

export function filesystemPathComparisonKey(
  pathValue: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = normalizeFilesystemPathForPolicy(pathValue, platform);
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

export function resolveFilesystemAccessPolicy(input: Readonly<{
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}> = {}): FilesystemAccessPolicy {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const raw = typeof env[MACHINE_RPC_WORKING_DIRECTORY_ENV] === 'string'
    ? String(env[MACHINE_RPC_WORKING_DIRECTORY_ENV])
    : '';

  if (raw.trim().length === 0) {
    return { kind: 'osUser' };
  }

  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new FilesystemAccessPolicyConfigurationError(
      `${MACHINE_RPC_WORKING_DIRECTORY_ENV} must contain at least one absolute directory`,
      [],
    );
  }

  const invalidRoots: string[] = [];
  const roots: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const expanded = expandHomeDirPath(entry, env, platform).trim();
    if (!isFilesystemPathAbsolute(expanded, platform)) {
      invalidRoots.push(entry);
      continue;
    }

    const normalized = normalizeFilesystemPathForPolicy(expanded, platform);
    const key = filesystemPathComparisonKey(normalized, platform);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    roots.push(normalized);
  }

  if (invalidRoots.length > 0 || roots.length === 0) {
    throw new FilesystemAccessPolicyConfigurationError(
      `${MACHINE_RPC_WORKING_DIRECTORY_ENV} must contain only absolute directories`,
      invalidRoots.length > 0 ? invalidRoots : entries,
    );
  }

  return { kind: 'restrictedRoots', roots };
}
