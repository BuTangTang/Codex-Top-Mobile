import { z } from 'zod';

import { AgentRuntimeDescriptorV1Schema } from '../sessionMetadata/agentRuntimeDescriptorV1.js';
import { CODEX_BACKEND_MODES } from '../providers/codex/backendMode.js';
import { AgentProviderIdV1Schema } from '../providers/agentProviderIdsV1.js';
import { SessionMessageRoleSchema } from '../sessionMessages/sessionMessageRole.js';
import { PendingLocalIdSchema } from '../sessionMessages/pendingLocalId.js';
import { SessionUserMessageSendRequestSchema, normalizeSessionAttachmentUploadPath } from '../sessionUserMessageRpc.js';
import { DirectSessionObservationV1Schema, DirectSessionNotificationsV1Schema } from './observationV1.js';

export const DirectSessionsProviderIdSchema = AgentProviderIdV1Schema;
export type DirectSessionsProviderId = z.infer<typeof DirectSessionsProviderIdSchema>;

const DirectSessionsCodexHomeSourceSchema = z
  .object({
    kind: z.literal('codexHome'),
    home: z.enum(['user', 'connectedService']),
    homePath: z.string().min(1).optional(),
    connectedServiceId: z.string().min(1).optional(),
    connectedServiceProfileId: z.string().min(1).optional(),
    connectedServiceGroupId: z.string().min(1).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.home === 'connectedService') {
      if (!value.connectedServiceId) {
        ctx.addIssue({ code: 'custom', message: 'connectedServiceId is required when home=connectedService', path: ['connectedServiceId'] });
      }
      return;
    }
    if (value.connectedServiceId) {
      ctx.addIssue({ code: 'custom', message: 'connectedServiceId is not allowed when home=user', path: ['connectedServiceId'] });
    }
    if (value.connectedServiceProfileId) {
      ctx.addIssue({ code: 'custom', message: 'connectedServiceProfileId is not allowed when home=user', path: ['connectedServiceProfileId'] });
    }
    if (value.connectedServiceGroupId) {
      ctx.addIssue({ code: 'custom', message: 'connectedServiceGroupId is not allowed when home=user', path: ['connectedServiceGroupId'] });
    }
  });

const DirectSessionsClaudeConfigSourceSchema = z
  .object({
    kind: z.literal('claudeConfig'),
    configDir: z.string().min(1).max(10_000).nullish(),
    projectId: z.string().min(1).max(2000).nullish(),
  })
  .passthrough();

const DirectSessionsOpenCodeServerSourceSchema = z
  .object({
    kind: z.literal('opencodeServer'),
    baseUrl: z.string().url().nullish(),
    directory: z.string().min(1).max(10_000).nullish(),
  })
  .passthrough();

const DirectSessionsPiAgentDirSourceSchema = z
  .object({
    kind: z.literal('piAgentDir'),
    // Resolved ~/.pi/agent directory; falls back to env PI_CODING_AGENT_DIR / ~/.pi/agent when nullish.
    agentDir: z.string().min(1).max(10_000).nullish(),
  })
  .passthrough();

/**
 * Generic source for agents whose ACP server advertises `session/list`. It carries no provider
 * identity and no filesystem location: candidates are produced by the agent itself over ACP and are
 * resume-only. `cwd` is the optional ACP working-directory filter and must be absolute.
 */
const DirectSessionsAcpSessionListSourceSchema = z
  .object({
    kind: z.literal('acpSessionList'),
    cwd: z.string().min(1).max(10_000).nullish(),
  })
  .passthrough();

export const DirectSessionsSourceSchema = z.discriminatedUnion('kind', [
  DirectSessionsCodexHomeSourceSchema,
  DirectSessionsClaudeConfigSourceSchema,
  DirectSessionsOpenCodeServerSourceSchema,
  DirectSessionsPiAgentDirSourceSchema,
  DirectSessionsAcpSessionListSourceSchema,
]);
export type DirectSessionsSource = z.infer<typeof DirectSessionsSourceSchema>;

/**
 * Negotiates only the generic ACP `session/list` browse source. This capability is intentionally
 * resume-only and grants no transcript, follow, takeover, terminal, or writer authority.
 */
export const DirectSessionsAcpSessionListCapabilityRequestSchema = z.object({}).strict();
export type DirectSessionsAcpSessionListCapabilityRequest = z.infer<typeof DirectSessionsAcpSessionListCapabilityRequestSchema>;

export const DirectSessionsAcpSessionListCapabilityResponseSchema = z.object({
  ok: z.literal(true),
  capability: z.literal('acp_session_list_v1'),
  protocolVersion: z.literal(1),
  sourceKind: z.literal('acpSessionList'),
  resumeOnly: z.literal(true),
}).strict();
export type DirectSessionsAcpSessionListCapabilityResponse = z.infer<typeof DirectSessionsAcpSessionListCapabilityResponseSchema>;

export const DirectSessionsSearchModeSchema = z.enum(['fast', 'full']);
export type DirectSessionsSearchMode = z.infer<typeof DirectSessionsSearchModeSchema>;

export const DirectSessionsCandidatesListRequestSchema = z
  .object({
    machineId: z.string().min(1),
    providerId: DirectSessionsProviderIdSchema,
    source: DirectSessionsSourceSchema,
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    searchTerm: z.string().min(1).max(2000).optional(),
    searchMode: DirectSessionsSearchModeSchema.optional(),
  })
  .passthrough();
export type DirectSessionsCandidatesListRequest = z.infer<typeof DirectSessionsCandidatesListRequestSchema>;

export const DirectSessionsCandidatesListResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      candidates: z.array(z.lazy(() => DirectSessionCandidateV1Schema)),
      nextCursor: z.string().min(1).nullish(),
      searchIncomplete: z.boolean().optional(),
      capabilities: z.object({
        deleteCandidate: z.boolean(),
        linkWithoutOpening: z.literal(true).optional(),
        // 本机既有传输 owner 的单文件实际上限；旧响应缺失时不得推定默认值。
        attachmentUploadMaxBytes: z.number().int().positive().safe().optional(),
      }).optional(),
    })
    .passthrough(),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
      refreshRequired: z.literal(true).optional(),
    })
    .passthrough(),
]);
export type DirectSessionsCandidatesListResponse = z.infer<typeof DirectSessionsCandidatesListResponseSchema>;

export const DirectSessionCandidateDeleteRequestSchema = z
  .object({
    machineId: z.string().min(1),
    providerId: DirectSessionsProviderIdSchema,
    source: DirectSessionsSourceSchema,
    remoteSessionId: z.string().min(1).max(2000),
  })
  .passthrough();
export type DirectSessionCandidateDeleteRequest = z.infer<typeof DirectSessionCandidateDeleteRequestSchema>;

export const DirectSessionCandidateDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true), deleted: z.literal(true) }).passthrough(),
  z.object({
    ok: z.literal(false),
    errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
    error: z.string().min(1),
  }).passthrough(),
]);
export type DirectSessionCandidateDeleteResponse = z.infer<typeof DirectSessionCandidateDeleteResponseSchema>;

export const DirectSessionLinkEnsureRequestSchema = z
  .object({
    machineId: z.string().min(1),
    providerId: DirectSessionsProviderIdSchema,
    remoteSessionId: z.string().min(1).max(2000),
    titleHint: z.string().min(1).max(10_000).optional(),
    directoryHint: z.string().min(1).max(10_000).optional(),
    codexBackendMode: z.enum(CODEX_BACKEND_MODES).optional(),
    runtimeDescriptor: AgentRuntimeDescriptorV1Schema.optional(),
    source: DirectSessionsSourceSchema,
    openExisting: z.boolean().optional(),
  })
  .passthrough();
export type DirectSessionLinkEnsureRequest = z.infer<typeof DirectSessionLinkEnsureRequestSchema>;


export const DirectSessionLinkEnsureResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      sessionId: z.string().min(1),
      created: z.boolean(),
    })
    .passthrough(),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
    })
    .passthrough(),
]);
export type DirectSessionLinkEnsureResponse = z.infer<typeof DirectSessionLinkEnsureResponseSchema>;

export const DirectSessionActivityV1Schema = z.enum(['running', 'active_recently', 'idle', 'unknown']);
export type DirectSessionActivityV1 = z.infer<typeof DirectSessionActivityV1Schema>;

export const DirectSessionCandidateV1Schema = z
  .object({
    remoteSessionId: z.string().min(1).max(2000),
    title: z.string().min(1).max(10_000).optional(),
    updatedAtMs: z.number().int().min(0),
    transcriptVersion: z.string().min(1).optional(),
    createdAtMs: z.number().int().min(0).optional(),
    activity: DirectSessionActivityV1Schema.optional(),
    archived: z.boolean().optional(),
    details: z.object({}).passthrough().optional(),
  })
  .passthrough();
export type DirectSessionCandidateV1 = z.infer<typeof DirectSessionCandidateV1Schema>;

export const DirectSessionStatusGetRequestSchema = z
  .object({
    machineId: z.string().min(1),
    sessionId: z.string().min(1),
    providerId: DirectSessionsProviderIdSchema,
    remoteSessionId: z.string().min(1).max(2000),
    source: DirectSessionsSourceSchema,
  })
  .passthrough();
export type DirectSessionStatusGetRequest = z.infer<typeof DirectSessionStatusGetRequestSchema>;

export const DirectSessionAttachRequestSchema = z
  .object({
    machineId: z.string().min(1),
    sessionId: z.string().min(1),
    providerId: DirectSessionsProviderIdSchema,
    remoteSessionId: z.string().min(1).max(2000),
    source: DirectSessionsSourceSchema,
    leaseId: z.string().min(1).max(2000).optional(),
    ttlMs: z.number().int().min(1_000).max(15 * 60_000).optional(),
  })
  .passthrough();
export type DirectSessionAttachRequest = z.infer<typeof DirectSessionAttachRequestSchema>;

export const DirectSessionAttachResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      leaseId: z.string().min(1),
      expiresAtMs: z.number().int().min(0),
      renewed: z.boolean().optional(),
    })
    .passthrough(),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
    })
    .passthrough(),
]);
export type DirectSessionAttachResponse = z.infer<typeof DirectSessionAttachResponseSchema>;

export const DirectSessionDetachRequestSchema = z
  .object({
    machineId: z.string().min(1),
    sessionId: z.string().min(1),
    leaseId: z.string().min(1).max(2000),
  })
  .passthrough();
export type DirectSessionDetachRequest = z.infer<typeof DirectSessionDetachRequestSchema>;

export const DirectSessionDetachResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      detached: z.boolean(),
    })
    .passthrough(),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
    })
    .passthrough(),
]);
export type DirectSessionDetachResponse = z.infer<typeof DirectSessionDetachResponseSchema>;

export const DirectSessionFollowPolicySetRequestSchema = z
  .object({
    machineId: z.string().min(1),
    sessionId: z.string().min(1),
    providerId: DirectSessionsProviderIdSchema,
    remoteSessionId: z.string().min(1).max(2000),
    source: DirectSessionsSourceSchema,
    enabled: z.boolean(),
  })
  .passthrough();
export type DirectSessionFollowPolicySetRequest = z.infer<typeof DirectSessionFollowPolicySetRequestSchema>;

export const DirectSessionFollowPolicySetResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      enabled: z.boolean(),
      leaseActive: z.boolean(),
      notifications: DirectSessionNotificationsV1Schema.optional(),
      updatedAtMs: z.number().int().min(0),
    })
    .passthrough(),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
    })
    .passthrough(),
]);
export type DirectSessionFollowPolicySetResponse = z.infer<typeof DirectSessionFollowPolicySetResponseSchema>;

/** 附件描述沿既有 attachments.v1 元数据传递，正文与文件字节分开。 */
const DirectSessionLocalAttachmentV1Schema = z.object({
  name: z.string().min(1), path: z.string().min(1), kind: z.enum(['image', 'file']),
  mimeType: z.string().min(1).optional(), sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).passthrough();
export const DirectSessionAttachmentV1Schema = z.union([
  DirectSessionLocalAttachmentV1Schema.extend({ availability: z.undefined().optional() }),
  DirectSessionLocalAttachmentV1Schema.extend({ path: z.string().min(1).optional(), availability: z.literal('unavailable'), reason: z.string().min(1).max(100) }),
]);
export type DirectSessionAttachmentV1 = z.infer<typeof DirectSessionAttachmentV1Schema>;
export const DirectSessionUploadedAttachmentV1Schema = DirectSessionLocalAttachmentV1Schema.extend({
  availability: z.undefined().optional(),
  path: z.string().refine((path) => normalizeSessionAttachmentUploadPath(path) !== null),
  sizeBytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});
export type DirectSessionUploadedAttachmentV1 = z.infer<typeof DirectSessionUploadedAttachmentV1Schema>;
export const DirectSessionAttachmentsEnvelopeV1Schema = z.object({
  kind: z.literal('attachments.v1'), payload: z.object({ attachments: z.array(DirectSessionAttachmentV1Schema).min(1) }).passthrough(),
}).passthrough();
export const DirectSessionUploadedAttachmentsEnvelopeV1Schema = DirectSessionAttachmentsEnvelopeV1Schema.extend({
  payload: z.object({ attachments: z.array(DirectSessionUploadedAttachmentV1Schema).min(1) }).passthrough(),
});

/** 复用普通消息契约；原生目标由已关联会话确定，拒绝客户端指定路径或原生会话。 */
export const DirectSessionSendRequestSchema = SessionUserMessageSendRequestSchema.extend({
  machineId: z.string().min(1),
  sessionId: z.string().min(1),
  localId: PendingLocalIdSchema,
  text: z.string(),
}).strict().refine((request) => request.text.trim().length > 0
  || request.meta.desktopTextSendProtocol === 'native-auto-v1'
    && DirectSessionUploadedAttachmentsEnvelopeV1Schema.safeParse(request.meta.happier).success,
  { message: 'A direct message requires text or uploaded attachments' });
export type DirectSessionSendRequest = z.infer<typeof DirectSessionSendRequestSchema>;

export const DirectSessionStatusGetResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      machineOnline: z.boolean(),
      runnerActive: z.boolean(),
      activity: DirectSessionActivityV1Schema,
      observation: DirectSessionObservationV1Schema.optional(),
      notifications: DirectSessionNotificationsV1Schema.optional(),
      canTakeOverDirect: z.boolean(),
      canTakeOverPersist: z.boolean(),
      canForceStop: z.boolean(),
      // 可选字段保留旧 daemon 兼容；缺失能力不能被解释为允许向桌面发送。
      externalControl: z.object({
        canSend: z.boolean(),
        unavailableReason: z.string().min(1).optional(),
        // 只有明确协商的新普通文本入口可跳过手机控制快照，缺失时保留旧选路。
        textSendProtocol: z.literal('native-auto-v1').optional(),
      }).optional(),
      trustedPid: z.number().int().min(1).nullish(),
      lastKnownActivityAtMs: z.number().int().min(0).optional(),
    })
    .passthrough(),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
    })
    .passthrough(),
]);
export type DirectSessionStatusGetResponse = z.infer<typeof DirectSessionStatusGetResponseSchema>;

export const DirectTranscriptRawMessageV1Schema = z
  .object({
    id: z.string().min(1),
    createdAtMs: z.number().int().min(0),
    localId: z.string().min(1).nullable().optional(),
    messageRole: SessionMessageRoleSchema.nullable().optional(),
    raw: z.object({}).passthrough(),
  })
  .passthrough();
export type DirectTranscriptRawMessageV1 = z.infer<typeof DirectTranscriptRawMessageV1Schema>;

// Opt-in projection for text-only clients. Pagination still describes the source stream.
export function projectDirectTranscriptItems(
  items: DirectTranscriptRawMessageV1[],
  projection?: 'conversation_text',
): DirectTranscriptRawMessageV1[] {
  if (projection !== 'conversation_text') return items;
  return items.filter(({ raw }) => {
    if (raw.role !== 'user' && raw.role !== 'agent') return false;
    const content = raw.content;
    if (!content || typeof content !== 'object') return false;
    const value = content as Record<string, unknown>;
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta as Record<string, unknown> : null;
    const hasAttachments = DirectSessionAttachmentsEnvelopeV1Schema.safeParse(meta?.happier).success;
    if (value.type === 'text') return typeof value.text === 'string' && (value.text.trim().length > 0 || hasAttachments);
    if (raw.role !== 'agent' || value.type !== 'codex' || !value.data || typeof value.data !== 'object') return false;
    const data = value.data as Record<string, unknown>;
    return data.type === 'message' && typeof data.sidechainId !== 'string'
      && typeof data.message === 'string' && (data.message.trim().length > 0 || hasAttachments);
  });
}

export const DirectTranscriptPageRequestSchema = z
  .object({
    machineId: z.string().min(1),
    providerId: DirectSessionsProviderIdSchema,
    remoteSessionId: z.string().min(1).max(2000),
    source: DirectSessionsSourceSchema,
    direction: z.enum(['older', 'newer']),
    cursor: z.string().min(1).optional(),
    maxBytes: z.number().int().min(1).max(10 * 1024 * 1024).optional(),
    maxItems: z.number().int().min(1).max(5000).optional(),
    projection: z.literal('conversation_text').optional(),
  })
  .passthrough();
export type DirectTranscriptPageRequest = z.infer<typeof DirectTranscriptPageRequestSchema>;

// Keep `truncated` for released readers; only a page limit permits adjacent continuation.
export const DirectTranscriptTruncationReasonSchema = z.enum(['page_limit', 'source_discontinuity']);
export type DirectTranscriptTruncationReason = z.infer<typeof DirectTranscriptTruncationReasonSchema>;

// 只描述本次来源的可读性，不承诺历史完整；旧端缺字段时保持未知。
export const DirectTranscriptHistoryAvailabilitySchema = z.enum(['available', 'preview_only', 'unavailable']);
export type DirectTranscriptHistoryAvailability = z.infer<typeof DirectTranscriptHistoryAvailabilitySchema>;

export const DirectTranscriptPageResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      items: z.array(DirectTranscriptRawMessageV1Schema),
      nextCursor: z.string().min(1).nullish(),
      tailCursor: z.string().min(1).nullish(),
      hasMore: z.boolean(),
      historyAvailability: DirectTranscriptHistoryAvailabilitySchema.optional(),
      truncated: z.boolean().optional(),
      truncationReason: DirectTranscriptTruncationReasonSchema.optional(),
    })
    .passthrough()
    .superRefine((value, ctx) => {
      if (value.truncationReason === 'page_limit' && typeof value.nextCursor !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'page-limit transcript continuation requires a next cursor',
          path: ['nextCursor'],
        });
      }
    }),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
    })
    .passthrough(),
]);
export type DirectTranscriptPageResponse = z.infer<typeof DirectTranscriptPageResponseSchema>;

export const DirectTranscriptReadAfterRequestSchema = z
  .object({
    machineId: z.string().min(1),
    providerId: DirectSessionsProviderIdSchema,
    remoteSessionId: z.string().min(1).max(2000),
    source: DirectSessionsSourceSchema,
    cursor: z.string().min(1),
    maxBytes: z.number().int().min(1).max(10 * 1024 * 1024).optional(),
    maxItems: z.number().int().min(1).max(5000).optional(),
    projection: z.literal('conversation_text').optional(),
  })
  .passthrough();
export type DirectTranscriptReadAfterRequest = z.infer<typeof DirectTranscriptReadAfterRequestSchema>;

export function resolveDirectTranscriptContinuation(params: Readonly<{
  truncated?: boolean;
  truncationReason?: DirectTranscriptTruncationReason;
}>): 'complete' | DirectTranscriptTruncationReason {
  // Explicit facts are authoritative; providers retain their released boolean semantics.
  return params.truncationReason ?? (params.truncated === true ? 'source_discontinuity' : 'complete');
}

export const DirectTranscriptReadAfterResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      items: z.array(DirectTranscriptRawMessageV1Schema),
      nextCursor: z.string().min(1).nullish(),
      truncated: z.boolean(),
      truncationReason: DirectTranscriptTruncationReasonSchema.optional(),
      historyAvailability: DirectTranscriptHistoryAvailabilitySchema.optional(),
    })
    .passthrough()
    .superRefine((value, ctx) => {
      if (value.truncationReason === 'page_limit' && typeof value.nextCursor !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'page-limit transcript continuation requires a next cursor',
          path: ['nextCursor'],
        });
      }
    }),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
    })
    .passthrough(),
]);
export type DirectTranscriptReadAfterResponse = z.infer<typeof DirectTranscriptReadAfterResponseSchema>;

export const DirectSessionTakeoverRequestSchema = z
  .object({
    machineId: z.string().min(1),
    sessionId: z.string().min(1),
    forceStop: z.boolean().optional(),
  })
  .passthrough();
export type DirectSessionTakeoverRequest = z.infer<typeof DirectSessionTakeoverRequestSchema>;

export const DirectSessionTakeoverResponseSchema = z.union([
  z.object({ ok: z.literal(true) }).passthrough(),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
    })
    .passthrough(),
]);
export type DirectSessionTakeoverResponse = z.infer<typeof DirectSessionTakeoverResponseSchema>;

export const DirectSessionTakeoverPersistRequestSchema = z
  .object({
    machineId: z.string().min(1),
    sessionId: z.string().min(1),
    forceStop: z.boolean().optional(),
  })
  .passthrough();
export type DirectSessionTakeoverPersistRequest = z.infer<typeof DirectSessionTakeoverPersistRequestSchema>;

export const DirectSessionTakeoverPersistResponseSchema = z.union([
  z.object({ ok: z.literal(true), converted: z.boolean().optional() }).passthrough(),
  z
    .object({
      ok: z.literal(false),
      errorCode: z.enum(['invalid_request', 'machine_offline', 'provider_unavailable', 'internal_error']),
      error: z.string().min(1),
    })
    .passthrough(),
]);
export type DirectSessionTakeoverPersistResponse = z.infer<typeof DirectSessionTakeoverPersistResponseSchema>;
