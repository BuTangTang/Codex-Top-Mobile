import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerAccountScope } from '../scope/serverAccountScope';

const store = vi.hoisted(() => new Map<string, string>());

vi.mock('react-native-mmkv', () => {
    class MMKV {
        getString(key: string) {
            return store.get(key);
        }

        set(key: string, value: string) {
            store.set(key, value);
        }

        delete(key: string) {
            store.delete(key);
        }

        getAllKeys() {
            return [...store.keys()];
        }

        clearAll() {
            store.clear();
        }
    }

    return { MMKV };
});

type PersistedSessionDraftValueEnvelope = Readonly<{
    v: number;
    lastEditedAt: number;
    value: unknown;
}>;

type PersistedSessionDraftValuesBySessionId = Record<
    string,
    Record<string, PersistedSessionDraftValueEnvelope>
>;

type SessionLocalStateKeysModule = Readonly<{
    scopedSessionLocalStateKey: (baseKey: string, scope?: ServerAccountScope | null) => string;
    sessionDraftValuesStorageKey: (scope?: ServerAccountScope | null) => string;
}>;

type SessionDraftValuesPersistenceModule = Readonly<{
    loadPersistedSessionDraftValues: (scope?: ServerAccountScope | null) => PersistedSessionDraftValuesBySessionId;
    savePersistedSessionDraftValues: (
        values: PersistedSessionDraftValuesBySessionId,
        scope?: ServerAccountScope | null,
    ) => void;
    clearPersistedSessionDraftValues: (scope?: ServerAccountScope | null) => void;
}>;

const scopeA: ServerAccountScope = { serverId: 'server-a', accountId: 'account-a' };
const scopeB: ServerAccountScope = { serverId: 'server-a', accountId: 'account-b' };

async function importSessionLocalStateKeys(): Promise<SessionLocalStateKeysModule> {
    return await import('./sessionLocalStateKeys');
}

async function importSessionDraftValuesPersistence(): Promise<SessionDraftValuesPersistenceModule> {
    return await import('./sessionDraftValuesPersistence');
}

describe('session local-state keys', () => {
    beforeEach(() => {
        store.clear();
        vi.resetModules();
    });

    it('builds legacy and scoped session-local keys with the existing suffix format', async () => {
        const keys = await importSessionLocalStateKeys();

        expect(keys.scopedSessionLocalStateKey('session-draft-values-v1')).toBe('session-draft-values-v1');
        expect(keys.scopedSessionLocalStateKey('session-draft-values-v1', scopeA)).toBe(
            'session-draft-values-v1:scope:v2:8:server-a9:account-a',
        );
    });

    it('provides the canonical scoped storage key for semantic draft values', async () => {
        const keys = await importSessionLocalStateKeys();

        expect(keys.sessionDraftValuesStorageKey(scopeA)).toBe(
            'session-draft-values-v1:scope:v2:8:server-a9:account-a',
        );
        expect(keys.sessionDraftValuesStorageKey(scopeB)).toBe(
            'session-draft-values-v1:scope:v2:8:server-a9:account-b',
        );
    });
});

describe('session draft-values persistence', () => {
    beforeEach(() => {
        store.clear();
        vi.resetModules();
    });

    it('loads and saves scoped semantic draft value envelopes without leaking across accounts', async () => {
        const persistence = await importSessionDraftValuesPersistence();
        const values = {
            sessionA: {
                'routing.executionRunDelivery': {
                    v: 1,
                    lastEditedAt: 100,
                    value: 'interrupt',
                },
            },
        } satisfies PersistedSessionDraftValuesBySessionId;

        persistence.savePersistedSessionDraftValues(values, scopeA);

        expect(persistence.loadPersistedSessionDraftValues(scopeA)).toEqual(values);
        expect(persistence.loadPersistedSessionDraftValues(scopeB)).toEqual({});
        expect(persistence.loadPersistedSessionDraftValues()).toEqual({});
    });

    it('drops malformed entries field-by-field while preserving valid sibling envelopes', async () => {
        const keys = await importSessionLocalStateKeys();
        const persistence = await importSessionDraftValuesPersistence();
        store.set(
            keys.sessionDraftValuesStorageKey(scopeA),
            JSON.stringify({
                sessionA: {
                    'routing.executionRunDelivery': { v: 1, lastEditedAt: 200, value: 'prompt' },
                    missingValue: { v: 1, lastEditedAt: 200 },
                    invalidVersion: { v: 0, lastEditedAt: 200, value: 'x' },
                    invalidEditedAt: { v: 1, lastEditedAt: Number.NaN, value: 'x' },
                    notAnEnvelope: 'x',
                },
                emptyAfterFilter: {
                    bad: { value: 'x' },
                },
                arraySession: [],
            }),
        );

        expect(persistence.loadPersistedSessionDraftValues(scopeA)).toEqual({
            sessionA: {
                'routing.executionRunDelivery': { v: 1, lastEditedAt: 200, value: 'prompt' },
            },
        });
    });

    it('returns an empty map for malformed JSON and clears only the scoped key requested', async () => {
        const keys = await importSessionLocalStateKeys();
        const persistence = await importSessionDraftValuesPersistence();
        store.set(keys.sessionDraftValuesStorageKey(scopeA), '{bad');
        store.set(keys.sessionDraftValuesStorageKey(scopeB), JSON.stringify({
            sessionB: {
                'routing.executionRunDelivery': { v: 1, lastEditedAt: 300, value: 'prompt' },
            },
        }));

        expect(persistence.loadPersistedSessionDraftValues(scopeA)).toEqual({});

        persistence.clearPersistedSessionDraftValues(scopeB);

        expect(store.has(keys.sessionDraftValuesStorageKey(scopeA))).toBe(true);
        expect(store.has(keys.sessionDraftValuesStorageKey(scopeB))).toBe(false);
    });
});
