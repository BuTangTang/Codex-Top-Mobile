import type { AgentId } from '@/agents/catalog/catalog';
import type { CapabilityId } from '@/sync/api/capabilities/capabilitiesProtocol';

export function buildAgentCliCapabilityId(agentId: AgentId): Extract<CapabilityId, `cli.${string}`> {
    return `cli.${agentId}`;
}
