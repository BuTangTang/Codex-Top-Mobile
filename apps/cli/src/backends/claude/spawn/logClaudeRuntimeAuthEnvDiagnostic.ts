import { logger } from '@/ui/logger';
import {
    findConnectedServiceChildSelection,
    type ConnectedServiceChildSelection,
} from '@/daemon/connectedServices/connectedServiceChildEnvironment';

import { resolveClaudeRuntimeAuthEnvDiagnostic } from './resolveClaudeRuntimeAuthEnvDiagnostic';

function resolveConnectedServiceSelectionDiagnostic(
    selection: ConnectedServiceChildSelection | null,
): Record<string, unknown> | null {
    if (!selection) return null;
    if (selection.kind === 'profile') {
        return {
            kind: selection.kind,
            serviceId: selection.serviceId,
            profileId: selection.profileId,
        };
    }
    return {
        kind: selection.kind,
        serviceId: selection.serviceId,
        groupId: selection.groupId,
        activeProfileId: selection.activeProfileId,
        fallbackProfileId: selection.fallbackProfileId,
        generation: selection.generation,
    };
}

export function logClaudeRuntimeAuthEnvDiagnostic(params: Readonly<{
    logPrefix: string;
    sessionId?: string | null;
    startFrom?: string | null;
    runnerEnv: Pick<NodeJS.ProcessEnv, string>;
    childEnv: Pick<NodeJS.ProcessEnv, string>;
}>): void {
    const selection =
        findConnectedServiceChildSelection(params.runnerEnv, 'claude-subscription')
        ?? findConnectedServiceChildSelection(params.runnerEnv, 'anthropic');

    logger.debug(`[${params.logPrefix}] Claude runtime auth diagnostic`, {
        sessionId: params.sessionId ?? null,
        startFrom: params.startFrom ?? null,
        connectedServiceSelection: resolveConnectedServiceSelectionDiagnostic(selection),
        runnerEnv: resolveClaudeRuntimeAuthEnvDiagnostic(params.runnerEnv),
        childEnv: resolveClaudeRuntimeAuthEnvDiagnostic(params.childEnv),
    });
}
