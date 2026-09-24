import { describe, expect, it } from 'vitest';

import * as directSessionsRpc from './daemonRpcV1';
import {
  DirectSessionsSourceSchema,
  DirectTranscriptRawMessageV1Schema,
  DirectTranscriptPageResponseSchema,
  DirectTranscriptReadAfterResponseSchema,
  resolveDirectTranscriptContinuation,
} from './daemonRpcV1';

describe('Direct session external-owner control capability', () => {
  const status = {
    ok: true,
    machineOnline: true,
    runnerActive: false,
    activity: 'idle',
    canTakeOverDirect: true,
    canTakeOverPersist: true,
    canForceStop: false,
  };

  // 旧 daemon 的状态不代表支持向仍由桌面管理的会话发送消息。
  it('preserves legacy status without inventing an external control capability', () => {
    const result = directSessionsRpc.DirectSessionStatusGetResponseSchema.parse(status);
    expect(result).not.toHaveProperty('externalControl');
  });

  // RPC 是网络边界；字符串或缺失能力不能被手机误读为可发送。
  it('rejects malformed external control while accepting an explicit capability', () => {
    expect(directSessionsRpc.DirectSessionStatusGetResponseSchema.safeParse({
      ...status,
      externalControl: { canSend: 'true' },
    }).success).toBe(false);
    expect(directSessionsRpc.DirectSessionStatusGetResponseSchema.safeParse({
      ...status,
      externalControl: {},
    }).success).toBe(false);
    expect(directSessionsRpc.DirectSessionStatusGetResponseSchema.parse({
      ...status,
      externalControl: { canSend: true },
    })).toMatchObject({ runnerActive: false, externalControl: { canSend: true } });
  });
});

describe('DirectSessionSendRequestSchema', () => {
  const request = {
    machineId: 'machine-a',
    sessionId: 'linked-session-a',
    text: '继续检查测试结果',
    localId: 'mobile-message-a',
    meta: {},
  };

  // 已关联会话确定电脑端目标；客户端不能夹带本机路径或替换原生会话身份。
  it('accepts a linked-session message and rejects client-selected native targets', () => {
    expect(directSessionsRpc.DirectSessionSendRequestSchema.parse(request)).toEqual(request);
    expect(directSessionsRpc.DirectSessionSendRequestSchema.safeParse({
      ...request,
      remoteSessionId: 'another-native-thread',
      source: { kind: 'codexHome', home: 'user', homePath: '/another-home' },
    }).success).toBe(false);
  });

  // 桌面转发必须带稳定输入身份，不能在超时后以无身份的新请求重新执行。
  it('requires a nonempty local message identity', () => {
    const { localId: _localId, ...withoutIdentity } = request;
    expect(directSessionsRpc.DirectSessionSendRequestSchema.safeParse(withoutIdentity).success).toBe(false);
    expect(directSessionsRpc.DirectSessionSendRequestSchema.safeParse({ ...request, localId: '' }).success).toBe(false);
  });
});

describe('DirectSessionsSourceSchema', () => {
  it('accepts exact Codex user-home identity', () => {
    expect(DirectSessionsSourceSchema.parse({
      kind: 'codexHome',
      home: 'user',
      homePath: '/tmp/custom-codex-home',
    })).toEqual({
      kind: 'codexHome',
      home: 'user',
      homePath: '/tmp/custom-codex-home',
    });
  });

  it('accepts exact Codex connected-service profile identity', () => {
    expect(DirectSessionsSourceSchema.parse({
      kind: 'codexHome',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: 'work',
      homePath: '/tmp/connected/work/codex-home',
    })).toEqual({
      kind: 'codexHome',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: 'work',
      homePath: '/tmp/connected/work/codex-home',
    });
  });
});

describe('DirectTranscriptRawMessageV1Schema', () => {
  const item = {
    id: 'direct-1',
    createdAtMs: 1_700,
    raw: { role: 'agent', content: { type: 'output', data: { type: 'assistant' } } },
  };

  it('preserves canonical message-role metadata for downstream normalization', () => {
    expect(DirectTranscriptRawMessageV1Schema.parse({ ...item, messageRole: 'event' })).toMatchObject({
      messageRole: 'event',
    });
  });

  it('rejects invalid message-role metadata', () => {
    expect(DirectTranscriptRawMessageV1Schema.safeParse({ ...item, messageRole: 'not-a-role' }).success).toBe(false);
  });
});

describe('direct transcript history availability compatibility', () => {
  it.each([DirectTranscriptPageResponseSchema, DirectTranscriptReadAfterResponseSchema])('keeps missing availability unknown and validates explicit facts', (schema) => {
    const response = { ok: true, items: [], nextCursor: null, hasMore: false, truncated: false };
    expect(schema.parse(response)).not.toHaveProperty('historyAvailability');
    for (const historyAvailability of ['available', 'preview_only', 'unavailable']) {
      expect(schema.parse({ ...response, historyAvailability })).toMatchObject({ historyAvailability });
    }
    expect(schema.safeParse({ ...response, historyAvailability: 'complete' }).success).toBe(false);
  });
});

describe('resolveDirectTranscriptContinuation', () => {
  it('authorizes adjacent continuation only for an explicit page limit', () => {
    expect(resolveDirectTranscriptContinuation({ truncated: false, truncationReason: 'page_limit' })).toBe('page_limit');
    expect(resolveDirectTranscriptContinuation({ truncated: true, truncationReason: 'page_limit' })).toBe('page_limit');
  });

  it('fails closed for source discontinuity and legacy truncation without a reason', () => {
    expect(resolveDirectTranscriptContinuation({ truncated: true, truncationReason: 'source_discontinuity' })).toBe('source_discontinuity');
    expect(resolveDirectTranscriptContinuation({ truncated: true })).toBe('source_discontinuity');
    expect(resolveDirectTranscriptContinuation({ truncated: false })).toBe('complete');
  });

  it('requires a usable adjacent cursor for page-limit responses', () => {
    expect(DirectTranscriptReadAfterResponseSchema.safeParse({
      ok: true,
      items: [],
      nextCursor: null,
      truncated: false,
      truncationReason: 'page_limit',
    }).success).toBe(false);
    expect(DirectTranscriptReadAfterResponseSchema.safeParse({
      ok: true,
      items: [],
      nextCursor: 'next-page',
      truncated: false,
      truncationReason: 'page_limit',
    }).success).toBe(true);

    expect(DirectTranscriptPageResponseSchema.safeParse({
      ok: true,
      items: [],
      nextCursor: null,
      tailCursor: 'tail',
      hasMore: true,
      truncated: true,
      truncationReason: 'page_limit',
    }).success).toBe(false);
    expect(DirectTranscriptPageResponseSchema.safeParse({
      ok: true,
      items: [],
      nextCursor: 'older-page',
      tailCursor: 'tail',
      hasMore: true,
      truncated: true,
      truncationReason: 'page_limit',
    }).success).toBe(true);
  });
});

describe('direct session follow lifecycle schemas', () => {
  it('parses attach, detach, and follow-policy requests', () => {
    const attachSchema = (directSessionsRpc as Record<string, any>).DirectSessionAttachRequestSchema;
    const detachSchema = (directSessionsRpc as Record<string, any>).DirectSessionDetachRequestSchema;
    const followPolicySchema = (directSessionsRpc as Record<string, any>).DirectSessionFollowPolicySetRequestSchema;

    expect(attachSchema.parse({
      machineId: 'machine-1',
      sessionId: 'session-1',
      providerId: 'claude',
      remoteSessionId: 'remote-1',
      source: { kind: 'claudeConfig', configDir: '/tmp/.claude', projectId: 'project-1' },
      leaseId: 'lease-1',
      ttlMs: 30_000,
    })).toEqual({
      machineId: 'machine-1',
      sessionId: 'session-1',
      providerId: 'claude',
      remoteSessionId: 'remote-1',
      source: { kind: 'claudeConfig', configDir: '/tmp/.claude', projectId: 'project-1' },
      leaseId: 'lease-1',
      ttlMs: 30_000,
    });

    expect(detachSchema.parse({
      machineId: 'machine-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
    })).toEqual({
      machineId: 'machine-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
    });

    expect(followPolicySchema.parse({
      machineId: 'machine-1',
      sessionId: 'session-1',
      providerId: 'claude',
      remoteSessionId: 'remote-1',
      source: { kind: 'claudeConfig', configDir: '/tmp/.claude', projectId: 'project-1' },
      enabled: true,
    })).toEqual({
      machineId: 'machine-1',
      sessionId: 'session-1',
      providerId: 'claude',
      remoteSessionId: 'remote-1',
      source: { kind: 'claudeConfig', configDir: '/tmp/.claude', projectId: 'project-1' },
      enabled: true,
    });
  });
});

// 既有 errorCode 保持可解析；只有明确的布尔真值允许手机停止旧游标并提示刷新。
describe('candidate cursor refresh compatibility', () => {
  it('accepts legacy responses and validates the additive refresh marker', () => {
    const schema = directSessionsRpc.DirectSessionsCandidatesListResponseSchema;
    expect(schema.parse({ ok: true, candidates: [], nextCursor: null })).not.toHaveProperty('refreshRequired');
    const failure = { ok: false, errorCode: 'invalid_request', error: 'direct_sessions_list_refresh_required' };
    expect(schema.parse(failure)).not.toHaveProperty('refreshRequired');
    expect(schema.parse({ ...failure, refreshRequired: true })).toMatchObject({ refreshRequired: true });
    expect(schema.safeParse({ ...failure, refreshRequired: 'true' }).success).toBe(false);
  });
});
