import type { AccountPetMetadata } from "@/sync/domains/pets/accountPetLibraryTypes";
import type { LocalPetSourceMetadata } from "@/sync/domains/pets/localPetSourceMetadata";
import {
    areServerAccountScopesEqual,
    serverAccountScopeKeySuffix,
    type ServerAccountScope,
} from "@/sync/domains/scope/serverAccountScope";
import { normalizeAccountPetsById } from "@/sync/domains/pets/normalizeAccountPetLibrary";
import {
    loadLocalPetSourcesBySourceKey,
    saveLocalPetSourcesBySourceKey,
} from "@/sync/domains/state/persistence";

import type { StoreGet, StoreSet } from "./_shared";

export type PetsDomain = {
    petsScope: ServerAccountScope | null;
    accountPetsById: Record<string, AccountPetMetadata>;
    _accountPetsByScopeKey: Record<string, Record<string, AccountPetMetadata>>;
    activatePetsScope: (scope: ServerAccountScope, legacyScopes?: readonly ServerAccountScope[]) => void;
    clearPetsScope: () => void;
    localPetSourcesBySourceKey: Record<string, LocalPetSourceMetadata>;
    applyAccountPets: (pets: AccountPetMetadata[]) => void;
    applyAccountPetsForScope: (scope: ServerAccountScope, pets: AccountPetMetadata[]) => void;
    upsertAccountPet: (pet: AccountPetMetadata) => void;
    removeAccountPet: (petId: string) => void;
    upsertLocalPetSource: (source: LocalPetSourceMetadata) => void;
    removeLocalPetSource: (sourceKey: string) => void;
};

function resolvePetsScopeKey(scope: ServerAccountScope): string {
    return serverAccountScopeKeySuffix(scope);
}

function readScopedAccountPets(
    accountPetsByScopeKey: Record<string, Record<string, AccountPetMetadata>>,
    scope: ServerAccountScope,
): Record<string, AccountPetMetadata> {
    return accountPetsByScopeKey[resolvePetsScopeKey(scope)] ?? {};
}

function readScopedAccountPetsWithLegacyFallback(
    accountPetsByScopeKey: Record<string, Record<string, AccountPetMetadata>>,
    scope: ServerAccountScope,
    legacyScopes: readonly ServerAccountScope[],
): Readonly<{
    pets: Record<string, AccountPetMetadata>;
    accountPetsByScopeKey: Record<string, Record<string, AccountPetMetadata>>;
}> {
    const currentPets = readScopedAccountPets(accountPetsByScopeKey, scope);
    if (Object.keys(currentPets).length > 0) {
        return { pets: currentPets, accountPetsByScopeKey };
    }
    for (const legacyScope of legacyScopes) {
        const legacyPets = readScopedAccountPets(accountPetsByScopeKey, legacyScope);
        if (Object.keys(legacyPets).length === 0) continue;
        return {
            pets: legacyPets,
            accountPetsByScopeKey: upsertScopedPets(accountPetsByScopeKey, scope, legacyPets),
        };
    }
    return { pets: currentPets, accountPetsByScopeKey };
}

function upsertScopedPets(
    accountPetsByScopeKey: Record<string, Record<string, AccountPetMetadata>>,
    scope: ServerAccountScope,
    pets: Record<string, AccountPetMetadata>,
): Record<string, Record<string, AccountPetMetadata>> {
    return {
        ...accountPetsByScopeKey,
        [resolvePetsScopeKey(scope)]: pets,
    };
}

export function createPetsDomain<S extends PetsDomain>({
    set,
}: {
    set: StoreSet<S>;
    get: StoreGet<S>;
}): PetsDomain {
    const localPetSourcesBySourceKey = loadLocalPetSourcesBySourceKey();

    return {
        petsScope: null,
        accountPetsById: {},
        _accountPetsByScopeKey: {},
        localPetSourcesBySourceKey,
        activatePetsScope: (scope, legacyScopes = []) =>
            set((state) => {
                const resolved = readScopedAccountPetsWithLegacyFallback(
                    state._accountPetsByScopeKey,
                    scope,
                    legacyScopes,
                );
                return {
                    ...state,
                    petsScope: scope,
                    accountPetsById: resolved.pets,
                    _accountPetsByScopeKey: resolved.accountPetsByScopeKey,
                };
            }),
        clearPetsScope: () =>
            set((state) => ({
                ...state,
                petsScope: null,
                accountPetsById: {},
            })),
        applyAccountPets: (pets) =>
            set((state) => {
                const nextPets = normalizeAccountPetsById(pets);
                if (!state.petsScope) {
                    return {
                        ...state,
                        accountPetsById: nextPets,
                    };
                }
                return {
                    ...state,
                    accountPetsById: nextPets,
                    _accountPetsByScopeKey: upsertScopedPets(state._accountPetsByScopeKey, state.petsScope, nextPets),
                };
            }),
        applyAccountPetsForScope: (scope, pets) =>
            set((state) => {
                const nextPets = normalizeAccountPetsById(pets);
                const nextByScope = upsertScopedPets(state._accountPetsByScopeKey, scope, nextPets);
                if (!areServerAccountScopesEqual(state.petsScope, scope)) {
                    return {
                        ...state,
                        _accountPetsByScopeKey: nextByScope,
                    };
                }
                return {
                    ...state,
                    accountPetsById: nextPets,
                    _accountPetsByScopeKey: nextByScope,
                };
            }),
        upsertAccountPet: (pet) =>
            set((state) => {
                const nextPets = {
                    ...state.accountPetsById,
                    [pet.accountPetId]: pet,
                };
                if (!state.petsScope) {
                    return {
                        ...state,
                        accountPetsById: nextPets,
                    };
                }
                return {
                    ...state,
                    accountPetsById: nextPets,
                    _accountPetsByScopeKey: upsertScopedPets(state._accountPetsByScopeKey, state.petsScope, nextPets),
                };
            }),
        removeAccountPet: (petId) =>
            set((state) => {
                const next = { ...state.accountPetsById };
                delete next[petId];
                if (!state.petsScope) {
                    return {
                        ...state,
                        accountPetsById: next,
                    };
                }
                return {
                    ...state,
                    accountPetsById: next,
                    _accountPetsByScopeKey: upsertScopedPets(state._accountPetsByScopeKey, state.petsScope, next),
                };
            }),
        upsertLocalPetSource: (source) =>
            set((state) => {
                const nextSources = {
                    ...state.localPetSourcesBySourceKey,
                    [source.sourceKey]: source,
                };
                saveLocalPetSourcesBySourceKey(nextSources);
                return {
                    ...state,
                    localPetSourcesBySourceKey: nextSources,
                };
            }),
        removeLocalPetSource: (sourceKey) =>
            set((state) => {
                const next = { ...state.localPetSourcesBySourceKey };
                delete next[sourceKey];
                saveLocalPetSourcesBySourceKey(next);
                return {
                    ...state,
                    localPetSourcesBySourceKey: next,
                };
            }),
    };
}
