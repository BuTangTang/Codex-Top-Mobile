import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { AGENT_IDS } from '@happier-dev/agents';

import type { CatalogAgentId } from '@/backends/types';

export type ConnectedServiceMaterializedHomeTarget = Readonly<{
  kind: 'home';
  materializationIdentityId: string;
  agentId: CatalogAgentId;
  path: string;
  mtimeMs: number;
}>;

export type ConnectedServiceMaterializedAttemptTarget = Readonly<{
  kind: 'attempt';
  materializationIdentityId: string;
  agentId: CatalogAgentId;
  path: string;
  mtimeMs: number;
}>;

export type ConnectedServiceMaterializedCleanupTarget =
  | ConnectedServiceMaterializedHomeTarget
  | ConnectedServiceMaterializedAttemptTarget;

async function readDirectoryNames(path: string): Promise<ReadonlyArray<string>> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function parseAgentId(value: string): CatalogAgentId | null {
  return (AGENT_IDS as ReadonlyArray<string>).includes(value) ? value as CatalogAgentId : null;
}

async function readMtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return Number.POSITIVE_INFINITY;
    }
    throw error;
  }
}

function parseAttemptDirectoryName(name: string): Readonly<{
  materializationIdentityId: string;
  agentId: CatalogAgentId;
}> | null {
  for (const agentId of AGENT_IDS) {
    const marker = `-${agentId}-`;
    const markerIndex = name.lastIndexOf(marker);
    if (markerIndex <= 0) continue;
    const materializationIdentityId = name.slice(0, markerIndex);
    const suffix = name.slice(markerIndex + marker.length);
    if (!materializationIdentityId || !suffix) continue;
    return {
      materializationIdentityId,
      agentId,
    };
  }
  return null;
}

export async function listMaterializedHomeTargets(
  baseDir: string,
): Promise<ReadonlyArray<ConnectedServiceMaterializedHomeTarget>> {
  const targets: ConnectedServiceMaterializedHomeTarget[] = [];
  for (const materializationIdentityId of await readDirectoryNames(baseDir)) {
    if (materializationIdentityId === '.attempts') continue;
    const identityRoot = join(baseDir, materializationIdentityId);
    for (const agentDirName of await readDirectoryNames(identityRoot)) {
      const agentId = parseAgentId(agentDirName);
      if (!agentId) continue;
      const path = join(identityRoot, agentId);
      targets.push({
        kind: 'home',
        materializationIdentityId,
        agentId,
        path,
        mtimeMs: await readMtimeMs(path),
      });
    }
  }
  return targets;
}

export async function listMaterializedAttemptTargets(
  baseDir: string,
): Promise<ReadonlyArray<ConnectedServiceMaterializedAttemptTarget>> {
  const attemptsRoot = join(baseDir, '.attempts');
  const targets: ConnectedServiceMaterializedAttemptTarget[] = [];
  for (const name of await readDirectoryNames(attemptsRoot)) {
    const parsed = parseAttemptDirectoryName(name);
    if (!parsed) continue;
    const path = join(attemptsRoot, name);
    targets.push({
      kind: 'attempt',
      materializationIdentityId: parsed.materializationIdentityId,
      agentId: parsed.agentId,
      path,
      mtimeMs: await readMtimeMs(path),
    });
  }
  return targets;
}
