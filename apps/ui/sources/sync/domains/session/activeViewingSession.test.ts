import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    clearActiveViewingSessionId,
    clearActiveViewingSessionsForServerScopeReset,
    getActiveViewingSessionActivationId,
    getActiveViewingSessionId,
    getVisibleSessionIds,
    isSessionVisible,
    markSessionHidden,
    markSessionVisible,
    setActiveViewingSessionId,
} from './activeViewingSession';
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const { createServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
    return createServerProfilesModuleMock({
        importOriginal,
        overrides: {
            listServerProfiles: () => [{
                id: 'server-profile',
                name: 'Server',
                serverUrl: 'https://server.example.test',
                serverIdentityId: 'server-actual',
                legacyServerIds: ['server-alias'],
                createdAt: 1,
                updatedAt: 1,
                lastUsedAt: 1,
            }],
        },
    });
});

import {
    beginSessionViewingActivation,
    holdManualUnreadForActivation,
    resetSessionManualUnreadHoldsForTests,
    shouldSuppressAutomaticMarkViewed,
} from './readState/sessionManualUnreadHold';

describe('activeViewingSession', () => {
    beforeEach(() => {
        resetSessionManualUnreadHoldsForTests();
        clearActiveViewingSessionsForServerScopeReset();
        clearActiveViewingSessionId('session-1');
        clearActiveViewingSessionId('session-2');
    });

    it('does not let a stale cleanup clear a newer activation for the same session id', () => {
        setActiveViewingSessionId('session-1', 101);
        setActiveViewingSessionId('session-1', 202);

        clearActiveViewingSessionId('session-1');

        expect(getActiveViewingSessionId()).toBe('session-1');
        expect(getActiveViewingSessionActivationId()).toBe(202);

        clearActiveViewingSessionId('session-1');

        expect(getActiveViewingSessionId()).toBeNull();
        expect(getActiveViewingSessionActivationId()).toBeNull();
    });

    it('restores an older same-session activation when the newer activation clears first', () => {
        const olderActivationId = beginSessionViewingActivation('session-1');
        const newerActivationId = beginSessionViewingActivation('session-1');
        setActiveViewingSessionId('session-1', olderActivationId);
        setActiveViewingSessionId('session-1', newerActivationId);

        clearActiveViewingSessionId('session-1', newerActivationId);

        expect(getActiveViewingSessionId()).toBe('session-1');
        expect(getActiveViewingSessionActivationId()).toBe(olderActivationId);

        holdManualUnreadForActivation({
            sessionId: 'session-1',
            sessionSeq: 7,
            activationId: getActiveViewingSessionActivationId(),
        });
        expect(shouldSuppressAutomaticMarkViewed({
            sessionId: 'session-1',
            sessionSeq: 7,
            activationId: olderActivationId,
        })).toBe(true);
    });

    it('treats scoped visibility as visible for equivalent server identifiers', () => {
        markSessionVisible('session-1', 'server-actual');

        expect(isSessionVisible('session-1', 'server-actual')).toBe(true);
        expect(isSessionVisible('session-1', 'server-alias')).toBe(true);
        expect(isSessionVisible('session-1', 'server-profile')).toBe(true);
        expect(isSessionVisible('session-1', 'server-unrelated')).toBe(false);

        markSessionHidden('session-1', 'server-alias');
        expect(isSessionVisible('session-1', 'server-actual')).toBe(false);
    });

    it('clears focused viewing activations for equivalent server identifiers', () => {
        setActiveViewingSessionId('session-1', 101, 'server-actual');

        expect(getActiveViewingSessionId()).toBe('session-1');
        expect(getActiveViewingSessionActivationId()).toBe(101);

        clearActiveViewingSessionId('session-1', 101, 'server-alias');

        expect(getActiveViewingSessionId()).toBeNull();
        expect(getActiveViewingSessionActivationId()).toBeNull();
    });

    it('keeps visibility state available across module re-evaluation', async () => {
        markSessionVisible('session-1', 'server-actual');

        vi.resetModules();
        const reloaded = await import('./activeViewingSession');

        expect(reloaded.isSessionVisible('session-1', 'server-actual')).toBe(true);
        reloaded.markSessionHidden('session-1', 'server-actual');
    });

    it('clears stale viewing state when the app route leaves session screens', async () => {
        const { clearActiveViewingSessionsForNonSessionRoute } = await import('./activeViewingSession');

        setActiveViewingSessionId('session-1', 101, 'server-actual');
        markSessionVisible('session-1', 'server-actual');

        expect(clearActiveViewingSessionsForNonSessionRoute('/session/session-1')).toBe(false);
        expect(getActiveViewingSessionId()).toBe('session-1');
        expect(isSessionVisible('session-1', 'server-actual')).toBe(true);

        expect(clearActiveViewingSessionsForNonSessionRoute('/settings')).toBe(true);
        expect(getActiveViewingSessionId()).toBeNull();
        expect(isSessionVisible('session-1', 'server-actual')).toBe(false);
    });

    it('tracks visible session surfaces independently from focused viewing activation', () => {
        markSessionVisible('session-1');
        markSessionVisible('session-1');
        markSessionVisible('session-2');

        expect(isSessionVisible('session-1')).toBe(true);
        expect(isSessionVisible('session-2')).toBe(true);
        expect(getVisibleSessionIds()).toEqual(['session-1', 'session-2']);
        expect(getActiveViewingSessionId()).toBeNull();

        markSessionHidden('session-1');

        expect(isSessionVisible('session-1')).toBe(true);
        expect(getVisibleSessionIds()).toEqual(['session-1', 'session-2']);

        markSessionHidden('session-1');

        expect(isSessionVisible('session-1')).toBe(false);
        expect(isSessionVisible('session-2')).toBe(true);
        expect(getVisibleSessionIds()).toEqual(['session-2']);
    });
});
