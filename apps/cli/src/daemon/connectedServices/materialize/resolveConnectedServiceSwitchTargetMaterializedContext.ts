import type { ConnectedServiceMaterializationIdentityV1 } from '@happier-dev/protocol';

import type { CatalogAgentId } from '@/backends/types';
import { HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY } from '../connectedServiceChildEnvironment';
import { resolveConnectedServiceMaterializedRootDir } from './resolveConnectedServiceMaterializedRootDir';
import { resolveConnectedServiceTargetMaterializedRoot } from './resolveConnectedServiceTargetMaterializedRoot';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringRecord(value: unknown): Readonly<Record<string, string>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * Materialized target context a runtime-auth selection materializer may attach to its (otherwise
 * opaque) selection: the env entries and root the NEXT spawn will read after the switch-time
 * rematerialization. Provider-agnostic duck-typed read — every provider materializer that
 * rematerializes into a different home (Claude profile homes today) reports the same two fields.
 */
export function readConnectedServiceRuntimeAuthSelectionMaterializedContext(
  runtimeAuthSelection: unknown,
): Readonly<{
  targetMaterializedEnv: Readonly<Record<string, string>> | null;
  targetMaterializedRoot: string | null;
}> {
  if (!runtimeAuthSelection || typeof runtimeAuthSelection !== 'object' || Array.isArray(runtimeAuthSelection)) {
    return { targetMaterializedEnv: null, targetMaterializedRoot: null };
  }
  const record = runtimeAuthSelection as Record<string, unknown>;
  return {
    targetMaterializedEnv: asStringRecord(record.targetMaterializedEnv),
    targetMaterializedRoot: asNonEmptyString(record.targetMaterializedRoot),
  };
}

/**
 * Resolve the target materialized env + root the auth-switch continuity gate must prove against.
 *
 * The continuity gate proves resume reachability against the materialized home the NEXT spawn will
 * read. Resolution order:
 *
 * 1. The freshly materialized runtime-auth selection (when the switch already rematerialized the
 *    target before continuity). For a tracked CONNECTED session the inherited env points at the
 *    PRE-switch home — where the session file trivially exists — so proving against it is vacuous
 *    for any cross-home switch (the Jun-10 incident shape: a silent target-home import failure
 *    settles `metadata_only`/`spawn_next_turn` and strands at the spawn-time strict gate). The
 *    selection's `targetMaterializedEnv`/`targetMaterializedRoot` are the post-materialization
 *    truth; they are overlaid on the inherited env (next spawn env = base env + materializer env).
 *
 * 2. The inherited env, when it already yields a root (a tracked CONNECTED session whose home does
 *    not move).
 *
 * 3. The DETERMINISTIC root reconstructed from the materialization identity (the exact
 *    `<baseDir>/<identity>/<agentId>` layout the spawn will materialize into) for an INACTIVE
 *    switch (no inherited env) or a TRACKED NATIVE session being switched to connected (env with no
 *    materialized-root key, because native sessions run against `~/.<vendor>` directly).
 *
 * Reconstruction/overlay is a pure computation with no filesystem side effects; the spawn path
 * still performs the hard post-materialization `targetStrict` re-verify, so fail-closed semantics
 * are preserved. Provider-agnostic: `agentId` is a typed value, no provider branching.
 */
export function resolveConnectedServiceSwitchTargetMaterializedContext(input: Readonly<{
  agentId: CatalogAgentId;
  baseDir: string;
  inheritedEnv: Readonly<Record<string, string>> | null;
  effectiveIdentity: ConnectedServiceMaterializationIdentityV1 | null;
  /** Freshly materialized runtime-auth selection (opaque); read for its materialized env/root. */
  runtimeAuthSelection?: unknown;
}>): Readonly<{
  targetMaterializedEnv: Readonly<Record<string, string>> | null;
  targetMaterializedRoot: string | null;
}> {
  const inheritedEnv = input.inheritedEnv ?? null;
  const selectionContext = readConnectedServiceRuntimeAuthSelectionMaterializedContext(
    input.runtimeAuthSelection,
  );
  const selectionRoot = selectionContext.targetMaterializedRoot
    ?? resolveConnectedServiceTargetMaterializedRoot({
      agentId: input.agentId,
      targetMaterializedEnv: selectionContext.targetMaterializedEnv,
    });
  if (selectionRoot) {
    // Rule A: prove against the POST-materialization target. The selection env wins over stale
    // inherited provider keys, and the explicit root key is pinned to the materialized root so the
    // proof can never silently fall back to the pre-switch home.
    return {
      targetMaterializedEnv: {
        ...(inheritedEnv ?? {}),
        ...(selectionContext.targetMaterializedEnv ?? {}),
        [HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]: selectionRoot,
      },
      targetMaterializedRoot: selectionRoot,
    };
  }

  const inheritedRoot = resolveConnectedServiceTargetMaterializedRoot({
    agentId: input.agentId,
    targetMaterializedEnv: inheritedEnv,
  });
  const reconstructedRoot = input.effectiveIdentity
    ? resolveConnectedServiceMaterializedRootDir({
        baseDir: input.baseDir,
        agentId: input.agentId,
        materializationKey: input.effectiveIdentity.id,
        materializationIdentity: input.effectiveIdentity,
      })
    : null;

  // Keep the inherited env untouched when it already yields a root (a tracked CONNECTED session) or
  // when there is no identity to reconstruct from (no safe target → caller fails closed). Otherwise
  // inject the reconstructed root so a tracked native→connected (or inactive) switch has the target
  // the next spawn will materialize into.
  const targetMaterializedEnv = inheritedRoot || !reconstructedRoot
    ? inheritedEnv
    : {
        ...(inheritedEnv ?? {}),
        [HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]: reconstructedRoot,
      };

  return {
    targetMaterializedEnv,
    targetMaterializedRoot: resolveConnectedServiceTargetMaterializedRoot({
      agentId: input.agentId,
      targetMaterializedEnv,
    }),
  };
}
