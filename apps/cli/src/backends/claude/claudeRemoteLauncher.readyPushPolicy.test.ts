import { afterEach, describe, expect, it, vi } from 'vitest';

import { accountSettingsParse } from '@happier-dev/protocol';
import { createTurnAssistantPreviewTracker } from '@/agent/runtime/turnAssistantPreviewTracker';
import { shouldSendReadyPushNotification } from '@/settings/notifications/notificationsPolicy';
import { setActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';

import { createClaudeRemoteReadyHandler } from './claudeRemoteLauncher';

describe('createClaudeRemoteReadyHandler', () => {
  afterEach(() => {
    setActiveAccountSettingsSnapshot({
      source: 'none',
      settings: accountSettingsParse({}),
      settingsVersion: 0,
      loadedAtMs: 0,
      settingsSecretsReadKeys: [],
    });
    vi.unstubAllGlobals();
  });

  it('sends ready event but suppresses push when account settings disables ready pushes', () => {
    const settings = accountSettingsParse({
      notificationsSettingsV1: { v: 1, pushEnabled: true, ready: false, permissionRequest: true },
    });

    const sendSessionEvent = vi.fn();
    const sendToAllDevices = vi.fn();

    const onReady = createClaudeRemoteReadyHandler({
      session: { sessionId: 's_1', sendSessionEvent },
      pushSender: { sendToAllDevices },
      logPrefix: '[remote]',
      waitingForCommandLabel: 'Claude',
      getPending: () => null,
      getQueueSize: () => 0,
      shouldSendPush: () => shouldSendReadyPushNotification(settings),
    });

    onReady();

    expect(sendSessionEvent).toHaveBeenCalledWith({ type: 'ready' });
    expect(sendToAllDevices).not.toHaveBeenCalled();
  });

  it('sends push when idle and ready pushes are enabled', () => {
    const settings = accountSettingsParse({
      notificationsSettingsV1: { v: 1, pushEnabled: true, ready: true, permissionRequest: true },
    });

    const sendSessionEvent = vi.fn();
    const sendToAllDevices = vi.fn();

    const onReady = createClaudeRemoteReadyHandler({
      session: { sessionId: 's_1', sendSessionEvent },
      pushSender: { sendToAllDevices },
      logPrefix: '[remote]',
      waitingForCommandLabel: 'Claude',
      getPending: () => null,
      getQueueSize: () => 0,
      shouldSendPush: () => shouldSendReadyPushNotification(settings),
    });

    onReady();

    expect(sendSessionEvent).toHaveBeenCalledWith({ type: 'ready' });
    expect(sendToAllDevices).toHaveBeenCalledTimes(1);
  });

  it('uses the structured turn assistant preview when present', () => {
    const sendSessionEvent = vi.fn();
    const sendToAllDevices = vi.fn();
    const tracker = createTurnAssistantPreviewTracker();
    tracker.replace('The branch is ready to review.');

    const onReady = createClaudeRemoteReadyHandler({
      session: { sessionId: 's_1', sendSessionEvent },
      pushSender: { sendToAllDevices },
      logPrefix: '[remote]',
      waitingForCommandLabel: 'Claude',
      getPending: () => null,
      getQueueSize: () => 0,
      assistantPreviewTracker: tracker,
    });

    onReady();

    expect(sendToAllDevices).toHaveBeenCalledWith(
      'Claude',
      'The branch is ready to review.',
      { sessionId: 's_1' },
    );
  });

  it('falls back to the session-owned turn assistant snapshot when no structured preview exists', () => {
    const sendSessionEvent = vi.fn();
    const sendToAllDevices = vi.fn();
    const getTurnAssistantTextSnapshot = vi.fn(() => ({
      turnToken: 'turn-1',
      text: 'Central Claude response',
      observedAtMs: 123,
      seq: 12,
      localId: 'message-1',
      sidechainId: null,
      provider: 'claude',
      source: 'committed' as const,
    }));

    const onReady = createClaudeRemoteReadyHandler({
      session: { sessionId: 's_1', sendSessionEvent, getTurnAssistantTextSnapshot },
      pushSender: { sendToAllDevices },
      logPrefix: '[remote]',
      waitingForCommandLabel: 'Claude',
      getPending: () => null,
      getQueueSize: () => 0,
    });

    onReady({ turnToken: 'turn-1', startSeqExclusive: 10 });

    expect(getTurnAssistantTextSnapshot).toHaveBeenCalledWith({
      turnToken: 'turn-1',
      startSeqExclusive: 10,
    });
    expect(sendToAllDevices).toHaveBeenCalledWith(
      'Claude',
      'Central Claude response',
      { sessionId: 's_1' },
    );
  });

  it('reads session titles from class-style metadata snapshot methods without losing this binding', () => {
    const sendSessionEvent = vi.fn();
    const sendToAllDevices = vi.fn();
    const session = {
      sessionId: 's_1',
      metadata: {
        summary: {
          text: '  Automation session  ',
        },
      },
      sendSessionEvent,
      getMetadataSnapshot() {
        return this.metadata;
      },
    };

    const onReady = createClaudeRemoteReadyHandler({
      session,
      pushSender: { sendToAllDevices },
      logPrefix: '[remote]',
      waitingForCommandLabel: 'Claude',
      getPending: () => null,
      getQueueSize: () => 0,
    });

    expect(() => onReady()).not.toThrow();
    expect(sendSessionEvent).toHaveBeenCalledWith({ type: 'ready' });
    expect(sendToAllDevices).toHaveBeenCalledWith(
      'Automation session',
      expect.stringContaining('Claude'),
      { sessionId: 's_1' },
    );
  });

  it('does nothing when pending or queue is non-empty', () => {
    const sendSessionEvent = vi.fn();
    const sendToAllDevices = vi.fn();

    const onReady = createClaudeRemoteReadyHandler({
      session: { sessionId: 's_1', sendSessionEvent },
      pushSender: { sendToAllDevices },
      logPrefix: '[remote]',
      waitingForCommandLabel: 'Claude',
      getPending: () => ({ reason: 'pending' }),
      getQueueSize: () => 1,
    });

    onReady();

    expect(sendSessionEvent).not.toHaveBeenCalled();
    expect(sendToAllDevices).not.toHaveBeenCalled();
  });

  it('uses explicit Claude session notification settings as the ready fallback when no active snapshot exists', async () => {
    const settings = accountSettingsParse({
      notificationChannelsV1: [
        {
          v: 1,
          id: 'webhook-ready',
          kind: 'webhook',
          enabled: true,
          url: 'https://hooks.example.test/ready',
          topics: {
            ready: true,
            permissionRequest: false,
            userActionRequest: false,
          },
          readyIncludeMessageText: false,
        },
      ],
    });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 202,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    setActiveAccountSettingsSnapshot({
      source: 'none',
      settings: accountSettingsParse({}),
      settingsVersion: 0,
      loadedAtMs: 0,
      settingsSecretsReadKeys: [],
    });

    const sendSessionEvent = vi.fn();
    const sendToAllDevices = vi.fn();

    const onReady = createClaudeRemoteReadyHandler({
      session: { sessionId: 's_1', sendSessionEvent },
      accountSettings: settings,
      settingsSecretsReadKeys: [],
      pushSender: { sendToAllDevices },
      logPrefix: '[remote]',
      waitingForCommandLabel: 'Claude',
      getPending: () => null,
      getQueueSize: () => 0,
      shouldSendPush: () => shouldSendReadyPushNotification(settings),
    });

    onReady();

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    expect(sendToAllDevices).not.toHaveBeenCalled();
  });
});
