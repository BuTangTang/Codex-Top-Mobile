import { mergeModuleMock } from './_shared';

type ServerProfilesModule = typeof import('@/sync/domains/server/serverProfiles');
type ServerProfileScopeIdentity = Readonly<{
    id?: unknown;
    serverIdentityId?: unknown;
    legacyServerIds?: readonly unknown[];
}>;

export type CreateServerProfilesModuleMockOptions = Readonly<{
    importOriginal: <T>() => Promise<T>;
    overrides?: Partial<ServerProfilesModule>;
}>;

function normalizeId(raw: unknown): string {
    return String(raw ?? '').trim();
}

function coerceProfiles(raw: unknown): ServerProfileScopeIdentity[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is ServerProfileScopeIdentity => (
        typeof item === 'object'
        && item !== null
    ));
}

function findProfileByIdentifier(
    profiles: readonly ServerProfileScopeIdentity[],
    idRaw: unknown,
): ServerProfileScopeIdentity | null {
    const id = normalizeId(idRaw);
    if (!id) return null;
    return profiles.find((profile) => {
        if (normalizeId(profile.id) === id) return true;
        if (normalizeId(profile.serverIdentityId) === id) return true;
        return (profile.legacyServerIds ?? []).some((legacyId) => normalizeId(legacyId) === id);
    }) ?? null;
}

export async function createServerProfilesModuleMock({
    importOriginal,
    overrides = {},
}: CreateServerProfilesModuleMockOptions): Promise<ServerProfilesModule> {
    const mock = await mergeModuleMock<ServerProfilesModule>({
        importOriginal,
        overrides,
    });
    const listServerProfiles = mock.listServerProfiles;
    const listProfiles = (): ServerProfileScopeIdentity[] => coerceProfiles(listServerProfiles());
    const resolveScopeId = (profile: ServerProfileScopeIdentity): string => mock.resolveServerProfileScopeId({
        id: normalizeId(profile.id),
        serverIdentityId: normalizeId(profile.serverIdentityId) || null,
    });

    Object.defineProperties(mock, {
        getServerProfileById: {
            value: (id: string) => findProfileByIdentifier(listProfiles(), id),
            writable: true,
            enumerable: true,
            configurable: true,
        },
        resolveServerProfileScopeIdForIdentifier: {
            value: (id: string | null | undefined) => {
                const normalizedId = normalizeId(id);
                if (!normalizedId) return '';
                const profile = findProfileByIdentifier(listProfiles(), normalizedId);
                return profile ? resolveScopeId(profile) : normalizedId;
            },
            writable: true,
            enumerable: true,
            configurable: true,
        },
        areServerProfileIdentifiersEquivalent: {
            value: (left: string | null | undefined, right: string | null | undefined) => {
                const leftId = normalizeId(left);
                const rightId = normalizeId(right);
                if (!leftId || !rightId) return false;
                if (leftId === rightId) return true;
                const profiles = listProfiles();
                const leftProfile = findProfileByIdentifier(profiles, leftId);
                const rightProfile = findProfileByIdentifier(profiles, rightId);
                return Boolean(
                    leftProfile
                    && rightProfile
                    && normalizeId(leftProfile.id) === normalizeId(rightProfile.id),
                );
            },
            writable: true,
            enumerable: true,
            configurable: true,
        },
    });

    return mock;
}
