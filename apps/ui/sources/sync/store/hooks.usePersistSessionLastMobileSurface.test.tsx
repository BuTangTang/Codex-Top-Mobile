import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook } from '@/dev/testkit';
import {
    usePersistSessionLastMobileSurface,
    useSessionLastMobileSurface,
} from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storageStore';

describe('usePersistSessionLastMobileSurface', () => {
    it('does not rewrite local settings when the session surface is already current', async () => {
        const previousState = storage.getState();
        const applyLocalSettings = vi.fn();
        try {
            storage.setState((state) => ({
                ...state,
                localSettings: {
                    ...state.localSettings,
                    sessionLastMobileSurfaceBySessionId: {
                        session_1: 'git',
                    },
                },
                applyLocalSettings,
            }));

            const hook = await renderHook(() => usePersistSessionLastMobileSurface());

            act(() => {
                hook.getCurrent()('session_1', 'git');
            });

            expect(applyLocalSettings).not.toHaveBeenCalled();
            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('writes server-scoped keys when the session server is known locally', async () => {
        const previousState = storage.getState();
        const applyLocalSettings = vi.fn();
        try {
            storage.setState((state) => ({
                ...state,
                sessions: {
                    ...state.sessions,
                    session_1: {
                        id: 'session_1',
                        serverId: 'server_a',
                    } as any,
                },
                localSettings: {
                    ...state.localSettings,
                    sessionLastMobileSurfaceBySessionId: {},
                },
                applyLocalSettings,
            }));

            const hook = await renderHook(() => usePersistSessionLastMobileSurface());

            act(() => {
                hook.getCurrent()('session_1', 'git');
            });

            expect(applyLocalSettings).toHaveBeenCalledTimes(1);
            expect(applyLocalSettings.mock.calls[0]?.[0]).toEqual({
                sessionLastMobileSurfaceBySessionId: {
                    'server_a:session_1': 'git',
                },
            });
            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});

describe('useSessionLastMobileSurface', () => {
    it('falls back to legacy bare session ids when a server-scoped entry is missing', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                sessions: {
                    ...state.sessions,
                    session_1: {
                        id: 'session_1',
                        serverId: 'server_a',
                    } as any,
                },
                localSettings: {
                    ...state.localSettings,
                    sessionLastMobileSurfaceBySessionId: {
                        session_1: 'browse',
                    },
                },
            }));

            const hook = await renderHook(() => useSessionLastMobileSurface('session_1', 'server_a'));

            expect(hook.getCurrent()).toBe('browse');
            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
