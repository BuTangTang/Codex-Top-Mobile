import { getPersistenceStorage } from './persistence';
import { sessionDraftValuesStorageKey } from './sessionLocalStateKeys';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

export type PersistedSessionDraftValueEnvelope = Readonly<{
    v: number;
    lastEditedAt: number;
    value: unknown;
}>;

export type PersistedSessionDraftValuesBySessionId = Record<
    string,
    Record<string, PersistedSessionDraftValueEnvelope>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseEnvelope(value: unknown): PersistedSessionDraftValueEnvelope | null {
    if (!isRecord(value)) return null;
    const version = readFiniteNumber(value.v);
    const lastEditedAt = readFiniteNumber(value.lastEditedAt);
    if (!version || version < 1 || lastEditedAt === null) return null;
    if (!Object.prototype.hasOwnProperty.call(value, 'value')) return null;
    return {
        v: version,
        lastEditedAt,
        value: value.value,
    };
}

function sanitizeDraftValues(input: unknown): PersistedSessionDraftValuesBySessionId {
    if (!isRecord(input)) return {};

    const output: PersistedSessionDraftValuesBySessionId = {};
    for (const [sessionId, rawSessionValues] of Object.entries(input)) {
        if (!sessionId.trim() || !isRecord(rawSessionValues)) continue;

        const sessionValues: Record<string, PersistedSessionDraftValueEnvelope> = {};
        for (const [fieldId, rawEnvelope] of Object.entries(rawSessionValues)) {
            if (!fieldId.trim()) continue;
            const envelope = parseEnvelope(rawEnvelope);
            if (envelope) {
                sessionValues[fieldId] = envelope;
            }
        }
        if (Object.keys(sessionValues).length > 0) {
            output[sessionId] = sessionValues;
        }
    }
    return output;
}

function pruneEmptySessions(values: PersistedSessionDraftValuesBySessionId): PersistedSessionDraftValuesBySessionId {
    const output: PersistedSessionDraftValuesBySessionId = {};
    for (const [sessionId, fields] of Object.entries(values)) {
        if (Object.keys(fields).length > 0) {
            output[sessionId] = fields;
        }
    }
    return output;
}

export function loadPersistedSessionDraftValues(
    scope?: ServerAccountScope | null,
): PersistedSessionDraftValuesBySessionId {
    const raw = getPersistenceStorage().getString(sessionDraftValuesStorageKey(scope));
    if (!raw) return {};
    try {
        return sanitizeDraftValues(JSON.parse(raw));
    } catch {
        return {};
    }
}

export function savePersistedSessionDraftValues(
    values: PersistedSessionDraftValuesBySessionId,
    scope?: ServerAccountScope | null,
): void {
    getPersistenceStorage().set(sessionDraftValuesStorageKey(scope), JSON.stringify(pruneEmptySessions(values)));
}

export function clearPersistedSessionDraftValues(scope?: ServerAccountScope | null): void {
    getPersistenceStorage().delete(sessionDraftValuesStorageKey(scope));
}
