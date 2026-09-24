import { describe, expect, it } from 'vitest';

import {
    createInitialCodexTopPreviewState,
    listCodexTopPreviewSessions,
    resolveCodexTopPreviewApproval,
    sendCodexTopPreviewMessage,
    sessionHasPendingApproval,
    setCodexTopPreviewAppearance,
    setCodexTopPreviewNotifications,
} from './sampleModel';

describe('codex top preview sample model', () => {
    it('uses one labeled example computer for every session', () => {
        const state = createInitialCodexTopPreviewState();

        expect(state.computer.example).toBe(true);
        expect(state.sessions.length).toBeGreaterThan(0);
        expect(new Set(state.sessions.map((session) => session.computerId))).toEqual(new Set([state.computer.id]));
        expect(listCodexTopPreviewSessions(state, 'running', '').length).toBeGreaterThan(0);
        expect(listCodexTopPreviewSessions(state, 'pending', '').length).toBeGreaterThan(0);
        expect(listCodexTopPreviewSessions(state, 'done', '').length).toBeGreaterThan(0);
    });

    it('filters the home list by phase and search without mixing other phases', () => {
        const state = createInitialCodexTopPreviewState();
        const running = listCodexTopPreviewSessions(state, 'running', '');
        const title = running[0]?.title ?? '';

        expect(running.every((session) => session.phase === 'running')).toBe(true);
        expect(listCodexTopPreviewSessions(state, 'pending', title)).toEqual([]);
        expect(listCodexTopPreviewSessions(state, 'running', title).map((session) => session.id)).toContain(running[0]?.id);
    });

    it('appends a local message and leaves an empty send unchanged', () => {
        const state = createInitialCodexTopPreviewState();
        const session = state.sessions[0];
        if (!session) throw new Error('sample session missing');
        const before = session.messages.length;

        expect(sendCodexTopPreviewMessage(state, session.id, '   ')).toBe(state);

        const next = sendCodexTopPreviewMessage(state, session.id, '示例补充');
        const updated = next.sessions.find((item) => item.id === session.id);
        expect(updated?.messages).toHaveLength(before + 1);
        expect(updated?.messages.at(-1)?.role).toBe('user');
        expect(updated?.phase).toBe(session.phase);
        expect(sendCodexTopPreviewMessage(state, 'missing-session', '示例补充')).toBe(state);
    });

    it('resolves a pending approval locally and ignores sessions that are not waiting', () => {
        const state = createInitialCodexTopPreviewState();
        const pending = state.sessions.find((session) => sessionHasPendingApproval(session));
        const running = state.sessions.find((session) => !sessionHasPendingApproval(session));
        if (!pending || !running) throw new Error('sample phases missing');

        expect(resolveCodexTopPreviewApproval(state, running.id, 'confirm')).toBe(state);

        const confirmed = resolveCodexTopPreviewApproval(state, pending.id, 'confirm');
        const confirmedSession = confirmed.sessions.find((session) => session.id === pending.id);
        expect(confirmedSession?.phase).toBe('done');
        expect(sessionHasPendingApproval(confirmedSession!)).toBe(false);
        expect(listCodexTopPreviewSessions(confirmed, 'pending', '').some((session) => session.id === pending.id)).toBe(false);

        const rejected = resolveCodexTopPreviewApproval(state, pending.id, 'reject');
        const rejectedSession = rejected.sessions.find((session) => session.id === pending.id);
        expect(rejectedSession?.phase).toBe('done');
        expect(sessionHasPendingApproval(rejectedSession!)).toBe(false);
    });

    it('changes appearance and notification sample flags without rewriting sessions', () => {
        const state = createInitialCodexTopPreviewState();
        const withAppearance = setCodexTopPreviewAppearance(state, 'dark');
        const withNotifications = setCodexTopPreviewNotifications(withAppearance, false);

        expect(withAppearance.appearance).toBe('dark');
        expect(withAppearance.sessions).toBe(state.sessions);
        expect(setCodexTopPreviewAppearance(withAppearance, 'dark')).toBe(withAppearance);
        expect(withNotifications.notificationsEnabled).toBe(false);
        expect(withNotifications.sessions).toBe(state.sessions);
    });
});
