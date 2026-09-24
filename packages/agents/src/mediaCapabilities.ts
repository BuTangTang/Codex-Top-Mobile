import type { AgentId, AgentMediaCapabilityKey, AgentMediaCapabilitySupportLevel, AgentMediaCapabilities } from './types.js';
import { AGENTS_CORE } from './manifest.js';

export function getAgentMediaCapabilities(agentId: AgentId): AgentMediaCapabilities {
    return AGENTS_CORE[agentId].media;
}

export function getAgentMediaCapability(
    agentId: AgentId,
    capability: AgentMediaCapabilityKey,
): AgentMediaCapabilitySupportLevel {
    return getAgentMediaCapabilities(agentId)[capability];
}

export function isAgentMediaCapabilitySupported(agentId: AgentId, capability: AgentMediaCapabilityKey): boolean {
    return getAgentMediaCapability(agentId, capability) === 'supported';
}
