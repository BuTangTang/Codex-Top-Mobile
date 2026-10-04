import type { AgentId } from '@/agent/core';
import { getOrLoadCatalogHookPromise } from './catalogHookPromiseCache';
import { createDirectSessionProviderOpsResolver } from './directSessions/createDirectSessionProviderOpsResolver';
import { AGENTS_CORE } from '@happier-dev/agents';
import {
  type ConnectedServiceId,
  type DirectSessionsProviderId,
} from '@happier-dev/protocol';
import { AGENTS, CATALOG_AGENT_ID_POLICY } from '@/backends/catalogRegistry';
import type {
  AcpForkContinuationHandler,
  AgentCatalogEntry,
  CatalogAgentId,
  ConnectedServiceStateSharingDescriptor,
  ConnectedServiceSwitchContinuityParams,
  ConnectedServiceSwitchContinuityResult,
  DirectSessionProviderOps,
  ProviderAttachOps,
  ProviderNativeForkHandler,
  SessionCatalogControlAdapter,
  SessionGoalControlAdapter,
  SessionUsageLimitRecoveryControlAdapter,
  VendorResumeSupportFn,
} from './types';
import type {
  VerifyResumeReachableInput,
  VerifyResumeReachableResult,
} from '@/backends/connectedServices/verifyResumeReachableTypes';
import type { ConnectedServiceProviderRuntimeAuthAdapter } from '@/daemon/connectedServices/runtimeAuth/types';
import type { ConnectedServiceQuotaFetcherDescriptor } from '@/daemon/connectedServices/quotas/types';
import type {
  ConnectedServiceRuntimeAuthSelectionMaterializerParams,
} from '@/daemon/connectedServices/sessionAuthSwitch/runtimeAuthSelectionMaterializerTypes';
import type { ConnectedServicesProviderMaterializer } from '@/daemon/connectedServices/materialize/providerMaterializerTypes';
import {
  buildDefaultConnectedServiceCredentialLifecycleDescriptor,
  type ConnectedServiceCredentialLifecycleDescriptor,
} from '@/daemon/connectedServices/credentials/lifecycleTypes';
import type {
  ProviderTerminalAttachmentControlProbe,
  ProviderTerminalAttachmentRetirementHook,
  TerminalAttachmentControlDescriptorStatus,
} from './types';

export type { AgentCatalogEntry, AgentChecklistContributions, CatalogAgentId, CliDetectSpec } from './types';

export { AGENTS } from '@/backends/catalogRegistry';

export function requireCatalogEntry(agentId: CatalogAgentId): AgentCatalogEntry {
  const entry = AGENTS[agentId];
  if (!entry) throw new Error(`Missing catalog agent entry for ${agentId}`);
  return entry;
}

export function getConnectedServiceQuotaFetcherDescriptors(): ReadonlyArray<ConnectedServiceQuotaFetcherDescriptor> {
  return Object.values(AGENTS)
    .map((entry) => entry?.connectedServiceQuotaFetcherDescriptor)
    .filter((descriptor): descriptor is ConnectedServiceQuotaFetcherDescriptor => descriptor !== undefined);
}

export const notifyTerminalAttachmentRetiredThroughCatalog: ProviderTerminalAttachmentRetirementHook = async (params) => {
  const hooks = Object.values(AGENTS)
    .map((entry) => entry?.onTerminalAttachmentRetired)
    .filter((hook): hook is ProviderTerminalAttachmentRetirementHook => hook !== undefined);
  await Promise.all(hooks.map(async (hook) => await hook(params)));
};

export async function resolveTerminalAttachmentControlDescriptorStatusThroughCatalog(
  agentId: AgentId | null | undefined,
  params: Parameters<ProviderTerminalAttachmentControlProbe>[0],
): Promise<TerminalAttachmentControlDescriptorStatus> {
  const entry = AGENTS[resolveCatalogAgentId(agentId)];
  const probe = entry?.hasTerminalAttachmentControlDescriptor;
  if (!probe) return 'not_applicable';
  return await probe(params) ? 'available' : 'missing';
}

const cachedVendorResumeSupportPromises = new Map<CatalogAgentId, Promise<VendorResumeSupportFn>>();
// 默认注册表仍可变；共享解析器逐调用读取当前条目，且此入口只创建一份缓存。
const resolveDirectSessionProviderOps = createDirectSessionProviderOpsResolver((providerId) => AGENTS[providerId]);
const cachedProviderAttachOpsPromises = new Map<CatalogAgentId, Promise<ProviderAttachOps | null>>();
const cachedConnectedServiceMaterializerPromises = new Map<CatalogAgentId, Promise<ConnectedServicesProviderMaterializer | null>>();
const cachedConnectedServiceRuntimeAuthAdapterPromises = new Map<CatalogAgentId, Promise<ConnectedServiceProviderRuntimeAuthAdapter | null>>();
const cachedConnectedServiceCredentialLifecycleDescriptorPromises = new Map<CatalogAgentId, Promise<ConnectedServiceCredentialLifecycleDescriptor>>();
const cachedConnectedServiceStateSharingDescriptorPromises = new Map<CatalogAgentId, Promise<ConnectedServiceStateSharingDescriptor | null>>();
const cachedSessionCatalogControlAdapterPromises = new Map<CatalogAgentId, Promise<SessionCatalogControlAdapter | null>>();
const cachedSessionGoalControlAdapterPromises = new Map<CatalogAgentId, Promise<SessionGoalControlAdapter | null>>();
const cachedSessionUsageLimitRecoveryControlAdapterPromises = new Map<CatalogAgentId, Promise<SessionUsageLimitRecoveryControlAdapter | null>>();
const cachedAcpForkContinuationHandlerPromises = new Map<CatalogAgentId, Promise<AcpForkContinuationHandler | null>>();
const cachedProviderNativeForkHandlerPromises = new Map<CatalogAgentId, Promise<ProviderNativeForkHandler | null>>();

export async function getVendorResumeSupport(agentId?: AgentId | null): Promise<VendorResumeSupportFn> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = requireCatalogEntry(catalogId);
  return await getOrLoadCatalogHookPromise(cachedVendorResumeSupportPromises, catalogId, async () => {
    if (entry.vendorResumeSupport === 'supported') {
      return () => true;
    }
    if (entry.vendorResumeSupport === 'unsupported') {
      return () => false;
    }
    if (entry.getVendorResumeSupport) {
      return await entry.getVendorResumeSupport();
    }
    const resumeConfig = AGENTS_CORE[catalogId]?.resume;
    if (
      resumeConfig?.vendorResume === 'experimental'
      && 'experimentalResumePolicy' in resumeConfig
      && resumeConfig.experimentalResumePolicy === 'runtime_checked'
    ) {
      return () => true;
    }
    return () => false;
  });
}

/** 保留原公开异步函数及单个 await，解析与缓存规则由共享叶负责。 */
export async function getDirectSessionProviderOps(providerId: DirectSessionsProviderId): Promise<DirectSessionProviderOps> {
  return await resolveDirectSessionProviderOps(providerId);
}

export async function getProviderAttachOps(agentId?: AgentId | null): Promise<ProviderAttachOps | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  return await getOrLoadCatalogHookPromise(
    cachedProviderAttachOpsPromises,
    catalogId,
    () => entry?.getProviderAttachOps ? entry.getProviderAttachOps() : Promise.resolve(null),
  );
}

export async function getConnectedServiceMaterializer(agentId?: AgentId | null): Promise<ConnectedServicesProviderMaterializer | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  return await getOrLoadCatalogHookPromise(
    cachedConnectedServiceMaterializerPromises,
    catalogId,
    () => entry?.getConnectedServiceMaterializer
      ? entry.getConnectedServiceMaterializer()
      : Promise.resolve(null),
  );
}

export async function getConnectedServiceRuntimeAuthAdapter(agentId?: AgentId | null): Promise<ConnectedServiceProviderRuntimeAuthAdapter | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  return await getOrLoadCatalogHookPromise(
    cachedConnectedServiceRuntimeAuthAdapterPromises,
    catalogId,
    () => entry?.getConnectedServiceRuntimeAuthAdapter
      ? entry.getConnectedServiceRuntimeAuthAdapter()
      : Promise.resolve(null),
  );
}

export async function materializeConnectedServiceRuntimeAuthSelectionThroughCatalog(
  agentId: AgentId | null | undefined,
  params: ConnectedServiceRuntimeAuthSelectionMaterializerParams,
): Promise<unknown | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  if (!entry?.materializeConnectedServiceRuntimeAuthSelection) return null;
  return await entry.materializeConnectedServiceRuntimeAuthSelection(params);
}

export async function resolveConnectedServiceCredentialLifecycleDescriptor(
  agentId?: AgentId | null,
): Promise<ConnectedServiceCredentialLifecycleDescriptor> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  return await getOrLoadCatalogHookPromise(
    cachedConnectedServiceCredentialLifecycleDescriptorPromises,
    catalogId,
    async () => {
      const descriptor = entry?.getConnectedServiceCredentialLifecycleDescriptor
        ? await entry.getConnectedServiceCredentialLifecycleDescriptor()
        : null;
      return descriptor ?? buildDefaultConnectedServiceCredentialLifecycleDescriptor(catalogId);
    },
  );
}

export type ConnectedServiceGenerationApplicationScopeResolution =
  | Readonly<{
      status: 'supported';
      scope: 'per_session_runtime' | 'shared_group_auth_surface';
      ownerId: string;
    }>
  | Readonly<{
      status: 'unsupported' | 'unavailable';
      errorCode: string;
    }>;

/** Resolves application cardinality from the sole catalog declaration that owns the service. */
export async function resolveConnectedServiceGenerationApplicationScope(
  serviceId: ConnectedServiceId,
  agentId?: CatalogAgentId | null,
): Promise<ConnectedServiceGenerationApplicationScopeResolution> {
  const matches: ConnectedServiceCredentialLifecycleDescriptor[] = [];
  try {
    if (agentId) {
      const descriptor = await resolveConnectedServiceCredentialLifecycleDescriptor(agentId);
      if (!descriptor.serviceIds.includes(serviceId)) {
        return { status: 'unsupported', errorCode: 'generation_application_scope_service_unsupported' };
      }
      matches.push(descriptor);
    } else {
      for (const entry of Object.values(AGENTS)) {
        if (!entry) continue;
        const descriptor = await resolveConnectedServiceCredentialLifecycleDescriptor(entry.id);
        if (descriptor.serviceIds.includes(serviceId)) matches.push(descriptor);
      }
    }
  } catch {
    return { status: 'unavailable', errorCode: 'generation_application_scope_unavailable' };
  }
  if (matches.length === 0) {
    return { status: 'unsupported', errorCode: 'generation_application_scope_unsupported' };
  }
  if (matches.length !== 1) {
    return { status: 'unavailable', errorCode: 'generation_application_scope_ambiguous' };
  }
  const descriptor = matches[0]!;
  if (descriptor.generationApplicationScope === 'unsupported') {
    return { status: 'unsupported', errorCode: 'generation_application_scope_unsupported' };
  }
  if (descriptor.generationApplicationScope === 'shared_group_auth_surface') {
    if (descriptor.sharedGenerationApplicationServiceIds?.includes(serviceId) !== true) {
      return { status: 'unsupported', errorCode: 'generation_application_scope_service_unsupported' };
    }
    return { status: 'supported', scope: 'shared_group_auth_surface', ownerId: descriptor.providerId };
  }
  return { status: 'supported', scope: 'per_session_runtime', ownerId: descriptor.providerId };
}

export async function getConnectedServiceStateSharingDescriptor(agentId?: AgentId | null): Promise<ConnectedServiceStateSharingDescriptor | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  return await getOrLoadCatalogHookPromise(
    cachedConnectedServiceStateSharingDescriptorPromises,
    catalogId,
    () => entry?.getConnectedServiceStateSharingDescriptor
      ? entry.getConnectedServiceStateSharingDescriptor()
      : Promise.resolve(null),
  );
}

export async function resolveConnectedServiceSwitchContinuity(
  agentId: AgentId | null | undefined,
  params: ConnectedServiceSwitchContinuityParams,
): Promise<ConnectedServiceSwitchContinuityResult> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  if (!entry?.resolveConnectedServiceSwitchContinuity) {
    return { mode: 'unsupported', reason: 'provider_unsupported' };
  }
  return await entry.resolveConnectedServiceSwitchContinuity(params);
}

export async function verifyResumeReachableThroughCatalog(
  agentId: AgentId | null | undefined,
  input: VerifyResumeReachableInput,
): Promise<VerifyResumeReachableResult | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  if (!entry?.verifyResumeReachable) return null;
  return await entry.verifyResumeReachable(input);
}

export function resolveConnectedServiceCandidatePersistedSessionFile(
  agentId: AgentId | null | undefined,
  metadata: unknown,
): string | null {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  return entry?.resolveConnectedServiceCandidatePersistedSessionFile?.({ metadata }) ?? null;
}

/**
 * Where the Agent named by `agentId` would keep its own log for `vendorResumeId`
 * on this machine, when it derives that path rather than persisting it.
 *
 * The answer is a CANDIDATE: the provider knows the naming and layout rule, not
 * whether the file survived. The caller verifies it against the filesystem
 * before naming it to anyone, exactly as it does for a persisted proof path. A
 * provider that declares no derivation answers `null`, which is the same "no
 * log" callers already handle.
 */
export async function resolveAgentNativeSessionLogPathThroughCatalog(
  agentId: AgentId | null | undefined,
  input: Readonly<{ vendorResumeId: string }>,
): Promise<string | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  if (!entry?.resolveAgentNativeSessionLogPath) return null;
  return await entry.resolveAgentNativeSessionLogPath(input) ?? null;
}

export async function getSessionGoalControlAdapter(agentId?: AgentId | null): Promise<SessionGoalControlAdapter | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  return await getOrLoadCatalogHookPromise(
    cachedSessionGoalControlAdapterPromises,
    catalogId,
    () => entry?.getSessionGoalControlAdapter ? entry.getSessionGoalControlAdapter() : Promise.resolve(null),
  );
}

export async function getSessionCatalogControlAdapter(agentId?: AgentId | null): Promise<SessionCatalogControlAdapter | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  return await getOrLoadCatalogHookPromise(
    cachedSessionCatalogControlAdapterPromises,
    catalogId,
    () => entry?.getSessionCatalogControlAdapter ? entry.getSessionCatalogControlAdapter() : Promise.resolve(null),
  );
}

export async function getSessionUsageLimitRecoveryControlAdapter(agentId?: AgentId | null): Promise<SessionUsageLimitRecoveryControlAdapter | null> {
  const catalogId = resolveCatalogAgentId(agentId);
  const entry = AGENTS[catalogId];
  return await getOrLoadCatalogHookPromise(
    cachedSessionUsageLimitRecoveryControlAdapterPromises,
    catalogId,
    () => entry?.getSessionUsageLimitRecoveryControlAdapter
      ? entry.getSessionUsageLimitRecoveryControlAdapter()
      : Promise.resolve(null),
  );
}

export async function getAcpForkContinuationHandler(agentId: CatalogAgentId): Promise<AcpForkContinuationHandler | null> {
  const entry = AGENTS[agentId];
  return await getOrLoadCatalogHookPromise(
    cachedAcpForkContinuationHandlerPromises,
    agentId,
    () => entry?.getAcpForkContinuationHandler ? entry.getAcpForkContinuationHandler() : Promise.resolve(null),
  );
}

export async function getProviderNativeForkHandler(agentId: CatalogAgentId): Promise<ProviderNativeForkHandler | null> {
  const entry = AGENTS[agentId];
  return await getOrLoadCatalogHookPromise(
    cachedProviderNativeForkHandlerPromises,
    agentId,
    () => entry?.getProviderNativeForkHandler ? entry.getProviderNativeForkHandler() : Promise.resolve(null),
  );
}

/** 精确检查当前注册表，显式产品输入不能通过前缀截取变为另一种请求。 */
function isExactRegisteredCatalogAgentId(agentId: unknown): agentId is CatalogAgentId {
  return typeof agentId === 'string' && Object.prototype.hasOwnProperty.call(AGENTS, agentId);
}

/** 默认 CLI 沿用原输入校验；受限产品在任何归一化前检查原始 agent 与 backendTarget。 */
export function getCatalogBackendTargetSupportError(rawAgent: unknown, rawBackendTarget: unknown): string | null {
  if (CATALOG_AGENT_ID_POLICY.unsupportedAgentId === 'legacy-default') return null;
  if (rawAgent != null && !isExactRegisteredCatalogAgentId(rawAgent)) {
    return 'Unsupported catalog agent for this CLI artifact';
  }
  if (rawBackendTarget != null) {
    if (typeof rawBackendTarget !== 'object' || Array.isArray(rawBackendTarget)) {
      return 'Unsupported backend target for this CLI artifact';
    }
    const target = rawBackendTarget as { kind?: unknown; agentId?: unknown };
    if (target.kind !== 'builtInAgent' || !isExactRegisteredCatalogAgentId(target.agentId)) {
      return 'Unsupported backend target for this CLI artifact';
    }
  }
  return null;
}

/** 默认构建保留历史前缀与回退规则，产品只允许缺省或精确注册的提供方。 */
export function resolveCatalogAgentId(agentId?: AgentId | null): CatalogAgentId {
  const raw = agentId ?? CATALOG_AGENT_ID_POLICY.defaultAgentId;
  if (CATALOG_AGENT_ID_POLICY.unsupportedAgentId === 'reject') {
    if (!isExactRegisteredCatalogAgentId(raw)) throw new Error('Unsupported catalog agent for this CLI artifact');
    return raw;
  }
  const base = raw.split('-')[0] as CatalogAgentId;
  if (Object.prototype.hasOwnProperty.call(AGENTS, base)) {
    return base;
  }
  return CATALOG_AGENT_ID_POLICY.defaultAgentId;
}

export function resolveAgentCliSubcommand(agentId?: AgentId | null): CatalogAgentId {
  const catalogId = resolveCatalogAgentId(agentId);
  return requireCatalogEntry(catalogId).cliSubcommand;
}

export function resolveCatalogAgentIdForCliSubcommand(subcommand: string): CatalogAgentId | null {
  for (const [agentId, entry] of Object.entries(AGENTS) as Array<[CatalogAgentId, AgentCatalogEntry]>) {
    if (entry.cliSubcommand === subcommand) {
      return agentId;
    }
  }
  return null;
}
