import { join } from 'node:path';

import type { ConnectedServiceMaterializationIdentityV1 } from '@happier-dev/protocol';

import type { CatalogAgentId } from '@/backends/types';
import { normalizeMaterializationKeyForPath } from './normalizeMaterializationKeyForPath';
import { readConnectedServiceMaterializationIdentityV1 } from './createConnectedServiceMaterializationIdentity';

/**
 * Compute the DETERMINISTIC final materialized root directory for a connected-service spawn:
 * `<baseDir>/<materializationSegment>/<agentId>`, where the segment is the materialization identity
 * id (preferred) or the normalized materialization key.
 *
 * This is a pure path computation — NO filesystem side effects. It is the SAME root that
 * `materializeConnectedServicesForSpawn` commits the materialized env into, factored out so callers
 * that need the target root WITHOUT materializing (e.g. the inactive-session auth-switch continuity
 * check, which must reconstruct the target the next spawn will read) use one source of truth instead
 * of re-deriving the layout. Keeping it provider-agnostic: `agentId` is a typed value, no provider
 * branching.
 */
export function resolveConnectedServiceMaterializedRootDir(input: Readonly<{
  baseDir: string;
  agentId: CatalogAgentId;
  materializationKey: string;
  materializationIdentity?: ConnectedServiceMaterializationIdentityV1 | null;
}>): string {
  const materializationIdentity = readConnectedServiceMaterializationIdentityV1(
    input.materializationIdentity,
  );
  const materializationSegment =
    materializationIdentity?.id ?? normalizeMaterializationKeyForPath(input.materializationKey);
  return join(input.baseDir, materializationSegment, input.agentId);
}
