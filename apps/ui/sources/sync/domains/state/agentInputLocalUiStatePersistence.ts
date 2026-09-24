import { getPersistenceStorage } from './persistence';
import { agentInputLocalUiStateStorageKey } from './sessionLocalStateKeys';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

export type PersistedAgentInputLocalUiStateByOwnerKey = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizePersistedUiStateMap(input: unknown): PersistedAgentInputLocalUiStateByOwnerKey {
    if (!isRecord(input)) return {};
    const output: PersistedAgentInputLocalUiStateByOwnerKey = {};
    for (const [ownerKey, value] of Object.entries(input)) {
        if (ownerKey.trim() && isRecord(value)) {
            output[ownerKey] = value;
        }
    }
    return output;
}

export function loadPersistedAgentInputLocalUiState(
    scope?: ServerAccountScope | null,
): PersistedAgentInputLocalUiStateByOwnerKey {
    const raw = getPersistenceStorage().getString(agentInputLocalUiStateStorageKey(scope));
    if (!raw) return {};
    try {
        return sanitizePersistedUiStateMap(JSON.parse(raw));
    } catch {
        return {};
    }
}

export function savePersistedAgentInputLocalUiState(
    values: PersistedAgentInputLocalUiStateByOwnerKey,
    scope?: ServerAccountScope | null,
): void {
    getPersistenceStorage().set(agentInputLocalUiStateStorageKey(scope), JSON.stringify(values));
}

export function clearPersistedAgentInputLocalUiState(scope?: ServerAccountScope | null): void {
    getPersistenceStorage().delete(agentInputLocalUiStateStorageKey(scope));
}
