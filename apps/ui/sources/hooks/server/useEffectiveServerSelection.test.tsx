import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';

function randomScope(): string {
    return `selection_hook_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function stubWebRuntime(origin: string): void {
    const store = new Map<string, string>();
    globalThis.sessionStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => void store.clear(),
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
            return store.size;
        },
    };
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            location: {
                origin,
                hostname: new URL(origin).hostname,
            },
        },
    });
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {},
    });
}

describe('useResolvedActiveServerSelection', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    afterEach(() => {
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        Reflect.deleteProperty(globalThis, 'sessionStorage');
        Reflect.deleteProperty(globalThis, 'window');
        Reflect.deleteProperty(globalThis, 'document');
        standardCleanup();
    });

    it('does not re-render for active server generation changes that keep selection inputs stable', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const active = profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        profiles.setActiveServerId(active.id, { scope: 'device' });

        const { useResolvedActiveServerSelection } = await import('./useEffectiveServerSelection');
        let renderCount = 0;
        const hook = await renderHook(() => {
            renderCount += 1;
            return useResolvedActiveServerSelection();
        });
        const initial = hook.getCurrent();
        const initialRenderCount = renderCount;

        await act(async () => {
            profiles.setServerProfileShareableUrl(active.id, 'https://active-shareable.example.test/tunnel');
        });

        expect(profiles.getActiveServerSnapshot().activeShareableServerUrl).toBe('https://active-shareable.example.test/tunnel');
        expect(hook.getCurrent()).toBe(initial);
        expect(renderCount).toBe(initialRenderCount);
        await hook.unmount();
    });

    it('uses the identity-backed active server id as an available server id', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const active = profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        profiles.setServerProfileIdentityForUrl(active.serverUrl, 'srv_identity_active');
        profiles.setActiveServerId(active.id, { scope: 'device' });

        const { useResolvedActiveServerSelection } = await import('./useEffectiveServerSelection');
        const hook = await renderHook(() => useResolvedActiveServerSelection());

        expect(profiles.getActiveServerSnapshot().serverId).toBe('srv_identity_active');
        expect(hook.getCurrent().activeServerId).toBe('srv_identity_active');
        expect(hook.getCurrent().allowedServerIds).toEqual(['srv_identity_active']);
        await hook.unmount();
    });

    it('re-renders when an inactive profile identity rewrite changes selection aliases', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const active = profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        const inactive = profiles.upsertServerProfile({
            serverUrl: 'https://inactive.example.test',
            name: 'Inactive',
        });
        profiles.setActiveServerId(active.id, { scope: 'device' });
        storage.getState().applySettingsLocal({
            serverSelectionGroups: [{
                id: 'grp-1',
                name: 'Group 1',
                serverIds: [inactive.id],
                presentation: 'grouped',
            }],
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: 'grp-1',
        });

        const { useResolvedActiveServerSelection } = await import('./useEffectiveServerSelection');
        let renderCount = 0;
        const hook = await renderHook(() => {
            renderCount += 1;
            return useResolvedActiveServerSelection();
        });

        expect(hook.getCurrent().allowedServerIds).toEqual([inactive.id]);
        const initialRenderCount = renderCount;

        await act(async () => {
            profiles.setServerProfileIdentityForUrl(inactive.serverUrl, 'srv_identity_inactive');
        });

        expect(hook.getCurrent().allowedServerIds).toEqual(['srv_identity_inactive']);
        expect(renderCount).toBeGreaterThan(initialRenderCount);
        await hook.unmount();
    });
});
