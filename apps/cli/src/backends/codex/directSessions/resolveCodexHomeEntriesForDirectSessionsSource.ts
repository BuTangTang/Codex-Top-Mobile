import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import type { DirectSessionsSource } from '@happier-dev/protocol';
import { resolveConfiguredCodexHome } from '../utils/resolveConfiguredCodexHome';

export type CodexDirectSessionHomeEntry = Readonly<{
  codexHome: string;
  source: DirectSessionsSource;
}>;

function isSafeConnectedServiceId(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(raw.trim());
}

function isSafeConnectedServiceProfileId(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(raw.trim());
}

function isSafeConnectedServiceGroupId(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(raw.trim());
}

function normalizeConnectedServiceId(raw: unknown): string | null {
  if (!isSafeConnectedServiceId(raw)) return null;
  return raw.trim();
}

function normalizeConnectedServiceProfileId(raw: unknown): string | null {
  if (!isSafeConnectedServiceProfileId(raw)) return null;
  return raw.trim();
}

function normalizeConnectedServiceGroupId(raw: unknown): string | null {
  if (!isSafeConnectedServiceGroupId(raw)) return null;
  return raw.trim();
}

function normalizeHomePath(raw: string): string {
  return resolve(raw.trim());
}

function isPathWithin(path: string, root: string): boolean {
  const rel = relative(root, path);
  if (rel.length === 0) return true;
  return !rel.startsWith('..') && !rel.startsWith(sep) && !rel.includes(`..${sep}`);
}

function resolveMaterializedRootsForActiveServerDir(activeServerDir: string): string[] {
  const normalizedActiveServerDir = resolve(activeServerDir);
  const roots = [
    join(normalizedActiveServerDir, 'daemon', 'connected-services', 'materialized'),
  ];
  const serversDir = dirname(normalizedActiveServerDir);
  if (basename(serversDir) === 'servers') {
    roots.unshift(join(dirname(serversDir), 'daemon', 'connected-services', 'materialized'));
  }
  return Array.from(new Set(roots));
}

function buildConnectedServiceCodexHome(activeServerDir: string, connectedServiceId: string, connectedServiceProfileId: string): string {
  return join(activeServerDir, 'daemon', 'connected-services', 'homes', connectedServiceId, connectedServiceProfileId, 'codex', 'codex-home');
}

function buildConnectedServiceGroupCodexHome(activeServerDir: string, connectedServiceId: string, connectedServiceGroupId: string): string {
  return join(activeServerDir, 'daemon', 'connected-services', 'homes', connectedServiceId, '__groups', connectedServiceGroupId, 'codex', 'codex-home');
}

/** 严格发现只容忍不存在；默认调用方仍沿用原来的缺失/不可用降级。 */
function rethrowHomeEnumerationFailure(error: unknown, strictEnumeration: boolean): void {
  if (strictEnumeration && (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
}

/** 校验精确 home 的归属；严格发现时保留权限及其他 IO 失败。 */
async function resolveVerifiedCodexHomePath(expectedPath: string, exactHomePath: string | null, strictEnumeration = false): Promise<string | null> {
  const targetPath = exactHomePath ?? expectedPath;
  try {
    const linkStats = await lstat(targetPath);
    if (linkStats.isSymbolicLink()) {
      return null;
    }
    const real = await realpath(targetPath);
    const expectedReal = await realpath(expectedPath).catch((error: unknown) => {
      rethrowHomeEnumerationFailure(error, strictEnumeration);
      return null;
    });
    if (!expectedReal || real !== expectedReal) {
      return null;
    }
    const stats = await stat(real);
    return stats.isDirectory() ? real : null;
  } catch (error) {
    rethrowHomeEnumerationFailure(error, strictEnumeration);
    return null;
  }
}

/** 在允许的物化目录内校验真实 home，并保留严格发现的 IO 失败。 */
async function resolveVerifiedMaterializedCodexHomePathInRoot(materializedRootInput: string, exactHomePath: string, strictEnumeration = false): Promise<string | null> {
  const materializedRoot = resolve(materializedRootInput);
  if (!isPathWithin(exactHomePath, materializedRoot)) return null;
  const relativeParts = relative(materializedRoot, exactHomePath).split(/[/\\]+/).filter(Boolean);
  if (relativeParts.length !== 3 || relativeParts[1] !== 'codex' || relativeParts[2] !== 'codex-home') {
    return null;
  }
  try {
    const linkStats = await lstat(exactHomePath);
    if (linkStats.isSymbolicLink()) {
      return null;
    }
    const materializedRootReal = await realpath(materializedRoot);
    const real = await realpath(exactHomePath);
    if (!isPathWithin(real, materializedRootReal)) {
      return null;
    }
    const stats = await stat(real);
    return stats.isDirectory() ? exactHomePath : null;
  } catch (error) {
    rethrowHomeEnumerationFailure(error, strictEnumeration);
    return null;
  }
}

/** 按现有物化目录顺序解析来源，将严格发现选项传到文件校验边界。 */
async function resolveVerifiedMaterializedCodexHomePath(activeServerDir: string, exactHomePath: string | null, strictEnumeration = false): Promise<string | null> {
  if (!exactHomePath) return null;
  for (const materializedRoot of resolveMaterializedRootsForActiveServerDir(activeServerDir)) {
    const verified = await resolveVerifiedMaterializedCodexHomePathInRoot(materializedRoot, exactHomePath, strictEnumeration);
    if (verified) return verified;
  }
  return null;
}

export function inferCodexDirectSessionsSourceFromHome(params: Readonly<{
  codexHome?: string | null;
  activeServerDir?: string | null;
}>): DirectSessionsSource {
  const codexHome = typeof params.codexHome === 'string' && params.codexHome.trim().length > 0
    ? normalizeHomePath(params.codexHome)
    : normalizeHomePath(join(homedir(), '.codex'));
  const activeServerDir = typeof params.activeServerDir === 'string' && params.activeServerDir.trim().length > 0
    ? resolve(params.activeServerDir.trim())
    : null;

  if (activeServerDir) {
    const homesRoot = join(activeServerDir, 'daemon', 'connected-services', 'homes');
    const relativeParts = codexHome.startsWith(`${homesRoot}/`) || codexHome.startsWith(`${homesRoot}\\`)
      ? codexHome.slice(homesRoot.length + 1).split(/[/\\]+/)
      : null;
    if (relativeParts && relativeParts.length === 4 && relativeParts[2] === 'codex' && relativeParts[3] === 'codex-home') {
      const [rawConnectedServiceId, rawConnectedServiceProfileId] = relativeParts;
      const connectedServiceId = normalizeConnectedServiceId(rawConnectedServiceId);
      const connectedServiceProfileId = normalizeConnectedServiceProfileId(rawConnectedServiceProfileId);
      if (connectedServiceId && connectedServiceProfileId) {
        return {
          kind: 'codexHome',
          home: 'connectedService',
          connectedServiceId,
          connectedServiceProfileId,
          homePath: codexHome,
        };
      }
    }
    if (relativeParts && relativeParts.length === 5 && relativeParts[1] === '__groups' && relativeParts[3] === 'codex' && relativeParts[4] === 'codex-home') {
      const [rawConnectedServiceId,, rawConnectedServiceGroupId] = relativeParts;
      const connectedServiceId = normalizeConnectedServiceId(rawConnectedServiceId);
      const connectedServiceGroupId = normalizeConnectedServiceGroupId(rawConnectedServiceGroupId);
      if (connectedServiceId && connectedServiceGroupId) {
        return {
          kind: 'codexHome',
          home: 'connectedService',
          connectedServiceId,
          connectedServiceGroupId,
          homePath: codexHome,
        };
      }
    }
  }

  return {
    kind: 'codexHome',
    home: 'user',
    homePath: codexHome,
  };
}

/** 解析实际 home 集合；候选列表可显式要求严格枚举，其他调用保持既有行为。 */
export async function resolveCodexHomeEntriesForDirectSessionsSource(params: Readonly<{
  source: DirectSessionsSource;
  activeServerDir: string;
  env: NodeJS.ProcessEnv;
  strictEnumeration?: boolean;
}>): Promise<CodexDirectSessionHomeEntry[]> {
  if (params.source.kind !== 'codexHome') return [];

  if (params.source.home === 'user') {
    const codexHome = typeof params.source.homePath === 'string' && params.source.homePath.trim().length > 0
      ? normalizeHomePath(params.source.homePath)
      : normalizeHomePath(resolveConfiguredCodexHome(params.env));
    return [{ codexHome, source: { kind: 'codexHome', home: 'user', homePath: codexHome } }];
  }

  const connectedServiceId = normalizeConnectedServiceId(params.source.connectedServiceId);
  if (!connectedServiceId) return [];

  const connectedServiceProfileId = normalizeConnectedServiceProfileId(params.source.connectedServiceProfileId);
  const connectedServiceGroupId = normalizeConnectedServiceGroupId(params.source.connectedServiceGroupId);
  const exactHomePath = typeof params.source.homePath === 'string' && params.source.homePath.trim().length > 0
    ? normalizeHomePath(params.source.homePath)
    : null;

  if (connectedServiceProfileId) {
    const materializedHome = await resolveVerifiedMaterializedCodexHomePath(params.activeServerDir, exactHomePath, params.strictEnumeration);
    if (materializedHome) {
      return [{
        codexHome: materializedHome,
        source: {
          kind: 'codexHome',
          home: 'connectedService',
          connectedServiceId,
          connectedServiceProfileId,
          homePath: materializedHome,
        },
      }];
    }
    const codexHome = buildConnectedServiceCodexHome(params.activeServerDir, connectedServiceId, connectedServiceProfileId);
    const verifiedHome = await resolveVerifiedCodexHomePath(codexHome, exactHomePath, params.strictEnumeration);
    if (!verifiedHome) {
      return [];
    }
    return [{
      codexHome: verifiedHome,
      source: {
        kind: 'codexHome',
        home: 'connectedService',
        connectedServiceId,
        connectedServiceProfileId,
        homePath: verifiedHome,
      },
    }];
  }

  if (connectedServiceGroupId) {
    const materializedHome = await resolveVerifiedMaterializedCodexHomePath(params.activeServerDir, exactHomePath, params.strictEnumeration);
    if (materializedHome) {
      return [{
        codexHome: materializedHome,
        source: {
          kind: 'codexHome',
          home: 'connectedService',
          connectedServiceId,
          connectedServiceGroupId,
          homePath: materializedHome,
        },
      }];
    }
    const codexHome = buildConnectedServiceGroupCodexHome(params.activeServerDir, connectedServiceId, connectedServiceGroupId);
    const verifiedHome = await resolveVerifiedCodexHomePath(codexHome, exactHomePath, params.strictEnumeration);
    if (!verifiedHome) {
      return [];
    }
    return [{
      codexHome: verifiedHome,
      source: {
        kind: 'codexHome',
        home: 'connectedService',
        connectedServiceId,
        connectedServiceGroupId,
        homePath: verifiedHome,
      },
    }];
  }

  if (exactHomePath) {
    const inferred = inferCodexDirectSessionsSourceFromHome({ codexHome: exactHomePath, activeServerDir: params.activeServerDir });
    if (inferred.kind !== 'codexHome' || inferred.home !== 'connectedService') {
      return [];
    }
    const inferredProfileId = normalizeConnectedServiceProfileId(inferred.connectedServiceProfileId);
    const inferredGroupId = normalizeConnectedServiceGroupId(inferred.connectedServiceGroupId);
    if (inferred.connectedServiceId !== connectedServiceId || (!inferredProfileId && !inferredGroupId)) {
      return [];
    }
    const expectedPath = inferredProfileId
      ? buildConnectedServiceCodexHome(params.activeServerDir, connectedServiceId, inferredProfileId)
      : buildConnectedServiceGroupCodexHome(params.activeServerDir, connectedServiceId, inferredGroupId!);
    const verifiedHome = await resolveVerifiedCodexHomePath(expectedPath, exactHomePath, params.strictEnumeration);
    if (!verifiedHome) {
      return [];
    }
    return [{
      codexHome: verifiedHome,
      source: {
        kind: 'codexHome',
        home: 'connectedService',
        connectedServiceId,
        ...(inferredProfileId ? { connectedServiceProfileId: inferredProfileId } : {}),
        ...(inferredGroupId ? { connectedServiceGroupId: inferredGroupId } : {}),
        homePath: verifiedHome,
      },
    }];
  }

  const entries: CodexDirectSessionHomeEntry[] = [];
  const base = join(params.activeServerDir, 'daemon', 'connected-services', 'homes', connectedServiceId);
  let profiles: Dirent[];
  try {
    profiles = await readdir(base, { withFileTypes: true });
  } catch (error) {
    rethrowHomeEnumerationFailure(error, params.strictEnumeration === true);
    return [];
  }

  for (const entry of profiles) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name === '__groups') continue;
    const profileId = normalizeConnectedServiceProfileId(entry.name);
    if (!profileId) continue;
    const codexHome = buildConnectedServiceCodexHome(params.activeServerDir, connectedServiceId, profileId);
    try {
      const s = await stat(codexHome);
      if (s.isDirectory()) {
        entries.push({
          codexHome,
          source: {
            kind: 'codexHome',
            home: 'connectedService',
            connectedServiceId,
            connectedServiceProfileId: profileId,
            homePath: codexHome,
          },
        });
      }
    } catch (error) {
      rethrowHomeEnumerationFailure(error, params.strictEnumeration === true);
    }
  }

  const groupsBase = join(base, '__groups');
  let groups: Dirent[];
  try {
    groups = await readdir(groupsBase, { withFileTypes: true });
  } catch (error) {
    rethrowHomeEnumerationFailure(error, params.strictEnumeration === true);
    return entries;
  }

  for (const entry of groups) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const groupId = normalizeConnectedServiceGroupId(entry.name);
    if (!groupId) continue;
    const codexHome = buildConnectedServiceGroupCodexHome(params.activeServerDir, connectedServiceId, groupId);
    try {
      const s = await stat(codexHome);
      if (s.isDirectory()) {
        entries.push({
          codexHome,
          source: {
            kind: 'codexHome',
            home: 'connectedService',
            connectedServiceId,
            connectedServiceGroupId: groupId,
            homePath: codexHome,
          },
        });
      }
    } catch (error) {
      rethrowHomeEnumerationFailure(error, params.strictEnumeration === true);
    }
  }

  return entries;
}
