import type { CapabilitiesDetectRequest, CapabilityId } from '@/sync/api/capabilities/capabilitiesProtocol';
import { AGENT_IDS } from '@/agents/catalog/catalog';
import { isAgentAuthProbeSafeForBackgroundChecks } from '@happier-dev/agents';
import { CHECKLIST_IDS } from '@happier-dev/protocol/checklists';
import { buildAgentCliCapabilityId } from './agentCliCapabilityId';

function buildCliLoginStatusOverrides(): Partial<Record<CapabilityId, { params: { includeLoginStatus: true } }>> {
    const overrides: Partial<Record<CapabilityId, { params: { includeLoginStatus: true } }>> = {};
    for (const agentId of AGENT_IDS) {
        if (!isAgentAuthProbeSafeForBackgroundChecks(agentId)) continue;
        overrides[buildAgentCliCapabilityId(agentId)] = { params: { includeLoginStatus: true } };
    }
    return overrides;
}

export const CAPABILITIES_REQUEST_NEW_SESSION: CapabilitiesDetectRequest = {
    checklistId: CHECKLIST_IDS.NEW_SESSION,
};

export const CAPABILITIES_REQUEST_MACHINE_DETAILS: CapabilitiesDetectRequest = {
    checklistId: CHECKLIST_IDS.MACHINE_DETAILS,
    overrides: buildCliLoginStatusOverrides(),
};
