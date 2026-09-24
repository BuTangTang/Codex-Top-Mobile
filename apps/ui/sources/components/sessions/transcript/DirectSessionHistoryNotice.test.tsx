import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, renderScreen } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { ListFooter } from './ChatListFrameSlots';
import { t } from '@/text';

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'android' });
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});

const initialState = storage.getState();

describe('DirectSessionHistoryNotice in the transcript footer', () => {
    beforeEach(() => { storage.setState(initialState, true); });

    function applySession(providerId: 'codex' | 'claude' | null) {
        storage.getState().applySessions([createSessionFixture({
            id: 'history-session', metadata: {
                path: '', host: '', machineId: 'machine-a',
                ...(providerId ? { directSessionV1: {
                    v: 1 as const, providerId, machineId: 'machine-a', remoteSessionId: 'native-session',
                    source: providerId === 'codex' ? { kind: 'codexHome' as const, home: 'user' as const } : { kind: 'claudeConfig' as const },
                } } : {}),
            },
        })]);
    }

    it('shows unknown for an old Codex source even before any transcript exists', async () => {
        applySession('codex');
        const screen = await renderScreen(<ListFooter sessionId="history-session" />);
        expect(screen.findByTestId('direct-session-history-notice')).not.toBeNull();
        expect(JSON.stringify(screen.tree.toJSON())).toContain(t('directSessions.historyAvailabilityUnknown'));
    });

    it('keeps the notice through normal messages and clears it after a readable snapshot', async () => {
        applySession('codex');
        const screen = await renderScreen(<ListFooter sessionId="history-session" />);
        for (const availability of ['preview_only', 'unavailable'] as const) {
            await act(async () => {
                storage.getState().setDirectSessionHistoryAvailability('history-session', availability);
                storage.getState().applyMessages('history-session', [{ id: availability, localId: null, createdAt: 1,
                    isSidechain: false, role: 'user', content: { type: 'text', text: 'retained body' } }]);
            });
            expect(screen.findByTestId('direct-session-history-notice')).not.toBeNull();
            expect(storage.getState().sessionMessages['history-session']?.directHistoryAvailability).toBe(availability);
        }
        await act(async () => { storage.getState().setDirectSessionHistoryAvailability('history-session', 'available'); });
        expect(screen.findByTestId('direct-session-history-notice')).toBeNull();
    });

    it.each(['claude', null] as const)('does not add history warnings to provider %s', async (provider) => {
        applySession(provider);
        const screen = await renderScreen(<ListFooter sessionId="history-session" />);
        expect(screen.findByTestId('direct-session-history-notice')).toBeNull();
    });

    it('does not rerender the history notice for unrelated session metadata', async () => {
        applySession('codex');
        const commits = vi.fn();
        await renderScreen(<React.Profiler id="history-notice" onRender={commits}><ListFooter sessionId="history-session" /></React.Profiler>);
        const committed = commits.mock.calls.length;
        const session = storage.getState().sessions['history-session']!;
        await act(async () => {
            storage.getState().applySessions([{ ...session, metadataVersion: 2, metadata: { ...session.metadata!, path: '/changed-workspace' } }]);
        });
        expect(commits).toHaveBeenCalledTimes(committed);
    });
});
