import { BackendTargetRefSchema, parseBackendTargetKey, type BackendTargetRefV1 } from '@happier-dev/protocol';

function parseSerializedBackendTarget(value: unknown): BackendTargetRefV1 | null {
    const parsed = BackendTargetRefSchema.safeParse(value);
    if (parsed.success) {
        return parsed.data;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsedJson = JSON.parse(trimmed);
        const parsedTarget = BackendTargetRefSchema.safeParse(parsedJson);
        return parsedTarget.success ? parsedTarget.data : null;
    } catch {
        return null;
    }
}

export function resolveBackendTargetFromRouteParams(params: Readonly<{
    backendTarget?: unknown;
    backendTargetKey?: unknown;
    agentType?: unknown;
}>): BackendTargetRefV1 | null {
    const parsedTarget = parseSerializedBackendTarget(params.backendTarget);
    if (parsedTarget) {
        return parsedTarget;
    }

    if (typeof params.backendTargetKey === 'string') {
        const trimmedKey = params.backendTargetKey.trim();
        if (trimmedKey) {
            try {
                return parseBackendTargetKey(trimmedKey);
            } catch {
                return null;
            }
        }
    }

    if (typeof params.agentType !== 'string') {
        return null;
    }

    const normalizedAgentType = params.agentType.trim();
    if (!normalizedAgentType || normalizedAgentType === 'customAcp') {
        return null;
    }

    if (normalizedAgentType.startsWith('acp:')) {
        const backendId = normalizedAgentType.slice(4).trim();
        return backendId ? { kind: 'configuredAcpBackend', backendId } : null;
    }

    return { kind: 'builtInAgent', agentId: normalizedAgentType };
}
