import { describe, expect, it, vi } from 'vitest';
import { accountSettingsParse } from '@happier-dev/protocol';

import { dispatchConnectedServiceCredentialHealthNotificationAsync } from './dispatchConnectedServiceCredentialHealthNotification';

type SendToAllDevicesAsync = (title: string, body: string, data: Record<string, unknown>) => Promise<void>;
type PushNotificationCall = Parameters<SendToAllDevicesAsync>;
type FetchNotificationCall = (input: unknown, init?: { body?: unknown }) => Promise<{ ok: boolean; status: number }>;
type PushNotificationSpy = Readonly<{
  mock: Readonly<{
    calls: PushNotificationCall[];
  }>;
}>;

function readOnlyPushNotificationCall(sendToAllDevicesAsync: PushNotificationSpy): PushNotificationCall {
  expect(sendToAllDevicesAsync.mock.calls).toHaveLength(1);
  const call = sendToAllDevicesAsync.mock.calls[0];
  if (!call) throw new Error('Expected one push notification call');
  return call;
}

describe('dispatchConnectedServiceCredentialHealthNotificationAsync', () => {
  it('does not expose provider account ids in outbound credential-health notifications', async () => {
    const sendToAllDevicesAsync = vi.fn<SendToAllDevicesAsync>(async (
      _title: string,
      _body: string,
      _data: Record<string, unknown>,
    ) => {});
    const fetchSpy = vi.fn<FetchNotificationCall>(async () => ({
      ok: true,
      status: 202,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    try {
      await dispatchConnectedServiceCredentialHealthNotificationAsync({
        settings: accountSettingsParse({
          notificationChannelsV1: [
            {
              v: 1,
              id: 'expo',
              kind: 'expo_push',
              enabled: true,
              topics: {
                ready: false,
                permissionRequest: false,
                userActionRequest: false,
                connectedServiceAccountSwitch: true,
                connectedServiceQuotaBlocked: false,
                connectedServiceQuotaRecovered: false,
              },
              readyIncludeMessageText: false,
            },
            {
              v: 1,
              id: 'webhook-primary',
              kind: 'webhook',
              enabled: true,
              url: 'https://hooks.example.test/happier',
              signingSecret: null,
              topics: {
                ready: false,
                permissionRequest: false,
                userActionRequest: false,
                connectedServiceAccountSwitch: true,
                connectedServiceQuotaBlocked: false,
                connectedServiceQuotaRecovered: false,
              },
              readyIncludeMessageText: false,
            },
          ],
        }),
        expoPushSender: { sendToAllDevicesAsync },
        settingsSecretsReadKeys: [],
        listConnectedServiceProfiles: vi.fn(async () => ({
          serviceId: 'openai-codex' as const,
          profiles: [{
            profileId: 'primary',
            status: 'connected' as const,
            providerEmail: null,
            providerAccountId: 'acct-provider-primary-secret',
          }],
        })),
        source: {
          sessionId: 'session-private-credential-health',
          sessionTitle: 'Investigate auth',
          serviceId: 'openai-codex',
          profileId: 'primary',
          status: 'reconnect_required',
          reason: 'invalid_grant',
          providerStatus: 400,
          providerErrorCode: 'invalid_grant',
        },
        nowMs: () => 2_000,
        dedupeWindowMs: 0,
      });

      const [_title, body, data] = readOnlyPushNotificationCall(sendToAllDevicesAsync);
      expect(body).not.toContain('acct-provider-primary-secret');
      expect(data).toMatchObject({ profileLabel: 'primary' });
      expect(JSON.stringify(data)).not.toContain('acct-provider-primary-secret');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const fetchCall = fetchSpy.mock.calls[0];
      if (!fetchCall) throw new Error('Expected one webhook notification call');
      const payloadText = String(fetchCall[1]?.body);
      const payload = JSON.parse(payloadText);
      expect(payload.content.body).not.toContain('acct-provider-primary-secret');
      expect(payload.metadata).toMatchObject({ profileLabel: 'primary' });
      expect(payloadText).not.toContain('acct-provider-primary-secret');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
