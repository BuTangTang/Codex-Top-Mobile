import type { CatalogAgentId } from '@/backends/types';
import { verifyResumeReachableThroughCatalog } from '@/backends/catalog';
import type {
  VerifyResumeReachableInput,
  VerifyResumeReachableResult,
} from '@/backends/connectedServices/verifyResumeReachableTypes';
import { REACHABILITY_CHECK_NOT_IMPLEMENTED_REASON } from '@/backends/connectedServices/verifyResumeReachableTypes';
export { REACHABILITY_CHECK_NOT_IMPLEMENTED_REASON } from '@/backends/connectedServices/verifyResumeReachableTypes';

/**
 * Provider-agnostic resume-reachability dispatch.
 *
 * This is the single call point used by BOTH the K1 spawn-time gate (`verifySpawnResumeReachability`)
 * and the continuity resolver (`canResumeFromMaterializedState`). It holds NO provider knowledge:
 * the per-provider probe is resolved through the backend catalog hook (`AgentCatalogEntry.verifyResumeReachable`,
 * implemented in each `backends/<provider>/index.ts`). A provider without the hook fails closed with the
 * stable `reachability_check_not_implemented` reason, preserving the previous central-switch default.
 */
export async function verifyResumeReachabilityByAgent(params: Readonly<{
  agentId: CatalogAgentId;
  input: VerifyResumeReachableInput;
}>): Promise<VerifyResumeReachableResult | Readonly<{ ok: false; reason: string }>> {
  const result = await verifyResumeReachableThroughCatalog(params.agentId, params.input);
  if (result === null) {
    return { ok: false, reason: REACHABILITY_CHECK_NOT_IMPLEMENTED_REASON };
  }
  return result;
}
