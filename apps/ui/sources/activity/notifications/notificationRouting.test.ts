import { describe, expect, it } from 'vitest';

import { PUSH_NOTIFICATION_ACTION_IDS } from '@happier-dev/protocol';
import { isUnsafeNotificationServerUrl, matchesNotificationSessionTarget, parseNotificationTap } from './notificationRouting';

// 桌面通知只打开已关联会话，不能因系统遗留按钮而变成审批。
describe('desktop open-only notifications', () => {
    it.each(['default', PUSH_NOTIFICATION_ACTION_IDS.permissionAllowV1, PUSH_NOTIFICATION_ACTION_IDS.permissionDenyV1])(
        'opens the linked session without approval for %s', (actionIdentifier) => {
            const tap = parseNotificationTap({ defaultActionIdentifier: 'default', response: {
                actionIdentifier, notification: { request: { identifier: 'event-1', content: { data: {
                    interaction: 'open_only', sessionId: 'linked/session', requestId: 'desktop-request',
                    url: '/session/wrong-native-id', serverUrl: 'https://owner.example.test',
                } } } },
            } });
            expect(tap).toMatchObject({ route: '/session/linked%2Fsession', permissionAction: null, isOpenAction: true });
        },
    );

    it.each([{ sessionId: 'linked' }, { serverUrl: 'https://owner.example.test', url: '/session/native' }])(
        'rejects open-only notifications without a linked session and server: %j', (data) => {
            expect(parseNotificationTap({ defaultActionIdentifier: 'default', response: {
                notification: { request: { content: { data: { ...data, interaction: 'open_only' } } } },
            } })).toBeNull();
        },
    );
});

describe('notification server URL safety', () => {
    it('rejects every loopback form that another device cannot reach', () => {
        expect(isUnsafeNotificationServerUrl('http://127.0.0.2:3005')).toBe(true);
        expect(isUnsafeNotificationServerUrl('http://relay.localhost:3005')).toBe(true);
        expect(isUnsafeNotificationServerUrl('https://machine.tailnet.ts.net')).toBe(false);
    });
});

describe('notification account boundary', () => {
    it('turns legacy approval buttons into navigation only', () => {
        const tap = parseNotificationTap({ defaultActionIdentifier: 'default', response: {
            actionIdentifier: PUSH_NOTIFICATION_ACTION_IDS.permissionAllowV1,
            notification: { request: { content: { data: { sessionId: 'session-a', requestId: 'old-request', serverUrl: 'https://owner.test' } } } },
        } });
        expect(tap).toMatchObject({ isOpenAction: true, permissionAction: null });
    });
    it('preserves only the bound non-secret direct target', () => {
        const target = { accountId: 'account-a', machineId: 'machine-a', notificationIdentity: 'a'.repeat(64) };
        const tap = parseNotificationTap({ defaultActionIdentifier: 'default', response: {
            notification: { request: { content: { data: { ...target, interaction: 'open_only', sessionId: 's', serverUrl: 'https://owner.test', message: 'not-a-route-field' } } } },
        } });
        expect(tap).toMatchObject({ target });
    });
});

describe('fresh source verification', () => {
    it('rejects another machine, relinked source identity, and absent authoritative metadata', () => {
        const target = { accountId: 'account-a', machineId: 'machine-a', notificationIdentity: 'a'.repeat(64) };
        const directSessionV1 = { v: 1, providerId: 'codex', machineId: 'machine-a', remoteSessionId: 'original-thread', source: { kind: 'codexHome', home: 'user' }, notificationStateV1: { identity: target.notificationIdentity } };
        expect(matchesNotificationSessionTarget(target, { directSessionV1 })).toBe(true);
        expect(matchesNotificationSessionTarget(target, { directSessionV1: { ...directSessionV1, machineId: 'machine-b' } })).toBe(false);
        expect(matchesNotificationSessionTarget(target, { directSessionV1: { ...directSessionV1, notificationStateV1: { identity: 'b'.repeat(64) } } })).toBe(false);
        expect(matchesNotificationSessionTarget(target, null)).toBe(false);
    });
});
