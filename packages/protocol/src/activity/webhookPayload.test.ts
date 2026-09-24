import { describe, expect, it } from 'vitest';

import { ActivityWebhookPayloadV1Schema, buildActivityWebhookPayload } from './webhookPayload.js';

describe('buildActivityWebhookPayload', () => {
  it('builds a ready webhook payload with session navigation', () => {
    const payload = buildActivityWebhookPayload({
      channelId: 'webhook-primary',
      createdAt: 123,
      topic: 'ready',
      content: {
        title: 'Review branch',
        body: 'The branch is ready to review.',
      },
      session: {
        sessionId: 'session-1',
        title: 'Review branch',
      },
      metadata: {
        providerLabel: 'Codex',
      },
    });

    expect(ActivityWebhookPayloadV1Schema.parse(payload)).toEqual(payload);
    expect(payload.navigation).toEqual({ sessionId: 'session-1' });
  });

  it('builds a request webhook payload without raw input fields', () => {
    const payload = buildActivityWebhookPayload({
      channelId: 'webhook-primary',
      createdAt: 456,
      topic: 'permission_request',
      content: {
        title: 'Permission Request',
        body: 'Approval needed for: Bash\nCommand: git',
      },
      session: {
        sessionId: 'session-2',
        title: 'Deploy fix',
      },
      request: {
        requestId: 'request-1',
        kind: 'permission',
        toolName: 'Bash',
        toolDetails: 'Command: git',
      },
    });

    expect(ActivityWebhookPayloadV1Schema.parse(payload)).toEqual(payload);
    expect(payload.navigation).toEqual({ sessionId: 'session-2', requestId: 'request-1' });
    expect(JSON.stringify(payload)).not.toContain('toolInput');
  });

  it('builds a connected-service quota webhook payload', () => {
    const payload = buildActivityWebhookPayload({
      channelId: 'webhook-primary',
      createdAt: 789,
      topic: 'connected_service_quota_blocked',
      content: {
        title: 'Provider quota blocked',
        body: 'Quota recovery is waiting for reset.',
      },
      session: {
        sessionId: 'session-3',
        title: 'Continue work',
      },
      metadata: {
        serviceId: 'openai-codex',
        groupId: 'codex-main',
        profileId: 'work',
      },
    });

    expect(ActivityWebhookPayloadV1Schema.parse(payload)).toEqual(payload);
    expect(payload.topic).toBe('connected_service_quota_blocked');
    expect(payload.navigation).toEqual({ sessionId: 'session-3' });
  });

  it('builds a connected-service credential health webhook payload', () => {
    const payload = buildActivityWebhookPayload({
      channelId: 'webhook-primary',
      createdAt: 790,
      topic: 'connected_service_credential_health',
      content: {
        title: 'Provider credential needs reconnect',
        body: 'Reconnect is required before this provider account can be used again.',
      },
      session: {
        sessionId: 'session-4',
        title: 'Continue work',
      },
      metadata: {
        serviceId: 'openai-codex',
        profileId: 'work',
        status: 'reconnect_required',
        providerErrorCode: 'invalid_grant',
      },
    });

    expect(ActivityWebhookPayloadV1Schema.parse(payload)).toEqual(payload);
    expect(payload.topic).toBe('connected_service_credential_health');
    expect(payload.navigation).toEqual({ sessionId: 'session-4' });
  });
});
