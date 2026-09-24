import {
    DirectSessionsProjectsListRequestSchema, DirectSessionsProjectsListResponseSchema,
    type DirectSessionsProjectsListRequest, type DirectSessionsProjectsListResponse,
    DirectSessionControlReadRequestSchema, DirectSessionControlReadResponseSchema,
    DirectSessionControlActionRequestSchema, DirectSessionControlActionResponseSchema,
    type DirectSessionControlActionRequest, type DirectSessionControlReadResponse, type DirectSessionControlActionResponse,
    DirectSessionAttachRequestSchema,
    DirectSessionAttachResponseSchema,
    DirectSessionDetachRequestSchema,
    DirectSessionDetachResponseSchema,
    type DirectSessionAttachRequest,
    type DirectSessionAttachResponse,
    type DirectSessionDetachRequest,
    type DirectSessionDetachResponse,
    DirectSessionFollowPolicySetRequestSchema,
    DirectSessionFollowPolicySetResponseSchema,
    type DirectSessionFollowPolicySetRequest,
    type DirectSessionFollowPolicySetResponse,
    DirectSessionSendRequestSchema,
    SessionUserMessageSendResponseSchema,
    type DirectSessionSendRequest,
    type SessionUserMessageSendResponse,
    DirectSessionLinkEnsureRequestSchema,
    DirectSessionLinkEnsureResponseSchema,
    DirectSessionCandidateDeleteRequestSchema,
    DirectSessionCandidateDeleteResponseSchema,
    DirectSessionStatusGetRequestSchema,
    DirectSessionStatusGetResponseSchema,
    DirectSessionTakeoverPersistRequestSchema,
    DirectSessionTakeoverPersistResponseSchema,
    DirectSessionTakeoverRequestSchema,
    DirectSessionTakeoverResponseSchema,
    DirectSessionsCandidatesListRequestSchema,
    DirectSessionsCandidatesListResponseSchema,
    DirectSessionsAcpSessionListCapabilityRequestSchema,
    DirectSessionsAcpSessionListCapabilityResponseSchema,
    DirectTranscriptPageRequestSchema,
    DirectTranscriptPageResponseSchema,
    DirectTranscriptReadAfterRequestSchema,
    DirectTranscriptReadAfterResponseSchema,
    type DirectSessionLinkEnsureRequest,
    type DirectSessionLinkEnsureResponse,
    type DirectSessionCandidateDeleteRequest,
    type DirectSessionCandidateDeleteResponse,
    type DirectSessionStatusGetRequest,
    type DirectSessionStatusGetResponse,
    type DirectSessionTakeoverPersistRequest,
    type DirectSessionTakeoverPersistResponse,
    type DirectSessionTakeoverRequest,
    type DirectSessionTakeoverResponse,
    type DirectSessionsCandidatesListRequest,
    type DirectSessionsCandidatesListResponse,
    type DirectTranscriptPageRequest,
    type DirectTranscriptPageResponse,
    type DirectTranscriptReadAfterRequest,
    type DirectTranscriptReadAfterResponse,
} from '@happier-dev/protocol';
import { RPC_METHODS, type SocketRpcAuthorizationContext } from '@happier-dev/protocol/rpc';
import type { ZodType, infer as ZodInfer } from 'zod';

import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import { isRpcMethodNotAvailableError, isRpcMethodNotFoundError } from '@/sync/runtime/rpcErrors';
import { readReplacementAwareMachineRpcTarget } from './machineRpcTarget';

type MachineDirectSessionsOpts = Readonly<{
    serverId?: string | null;
    timeoutMs?: number | null;
    onIssued?: () => void;
}>;

function throwUnsupportedResponse(method: string): never {
    throw new Error(`Unsupported response from machine RPC (${method})`);
}

/** 按所属服务器和有效机器目标调用 Direct RPC，校验请求与响应并透传授权及发出通知。 */
async function callDirectSessionMachineRpc<Request, Response>(params: Readonly<{
    machineId: string;
    method: string;
    input: Request;
    requestSchema: ZodType<Request>;
    responseSchema: ZodType<Response>;
    opts?: MachineDirectSessionsOpts;
    authorization?: SocketRpcAuthorizationContext;
}>): Promise<Response> {
    const payload = params.requestSchema.parse(params.input);
    const routeTarget = readReplacementAwareMachineRpcTarget(params.machineId);
    if (!routeTarget) {
        throw new Error(`Machine RPC target is unavailable (${params.method})`);
    }
    const response = await machineRpcWithServerScope<unknown, Request>({
        machineId: routeTarget.machineId,
        serverId: params.opts?.serverId,
        timeoutMs: params.opts?.timeoutMs ?? undefined,
        method: params.method,
        payload,
        ...(params.authorization ? { authorization: params.authorization } : {}),
        ...(params.opts?.onIssued ? { onIssued: params.opts.onIssued } : {}),
    });
    const parsed = params.responseSchema.safeParse(response);
    if (!parsed.success) {
        throwUnsupportedResponse(params.method);
    }
    return parsed.data;
}

/** 向原会话拥有者发送；沿用写授权和发出保护，禁止已发出请求被传输回退重投。 */
export async function machineDirectSessionSend(
    input: DirectSessionSendRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<SessionUserMessageSendResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_SEND,
        input,
        requestSchema: DirectSessionSendRequestSchema,
        responseSchema: SessionUserMessageSendResponseSchema,
        authorization: { kind: 'session.write', sessionId: input.sessionId },
        opts: {
            ...opts,
            // 即使界面不观察进度，也必须启用现有 transport 的单次发出保护。
            onIssued: () => { opts?.onIssued?.(); },
        },
    });
}

export async function machineDirectSessionsCandidatesList(
    input: DirectSessionsCandidatesListRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionsCandidatesListResponse> {
    if (input.source.kind === 'acpSessionList') {
        try {
            await callDirectSessionMachineRpc({
                machineId: input.machineId,
                method: RPC_METHODS.DAEMON_DIRECT_SESSIONS_ACP_SESSION_LIST_CAPABILITY_GET,
                input: {},
                requestSchema: DirectSessionsAcpSessionListCapabilityRequestSchema,
                responseSchema: DirectSessionsAcpSessionListCapabilityResponseSchema,
                opts,
            });
        } catch (error) {
            if (!isRpcMethodNotAvailableError(error) && !isRpcMethodNotFoundError(error)) {
                throw error;
            }
            return {
                ok: false,
                errorCode: 'provider_unavailable',
                error: 'acp_session_list_requires_daemon_upgrade',
            };
        }
    }
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSIONS_CANDIDATES_LIST,
        input,
        requestSchema: DirectSessionsCandidatesListRequestSchema,
        responseSchema: DirectSessionsCandidatesListResponseSchema,
        opts,
    });
}

export async function machineDirectSessionCandidateDelete(
    input: DirectSessionCandidateDeleteRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionCandidateDeleteResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_DELETE,
        input,
        requestSchema: DirectSessionCandidateDeleteRequestSchema,
        responseSchema: DirectSessionCandidateDeleteResponseSchema,
        opts,
    });
}

export async function machineDirectSessionLinkEnsure(
    input: DirectSessionLinkEnsureRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionLinkEnsureResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE,
        input,
        requestSchema: DirectSessionLinkEnsureRequestSchema,
        responseSchema: DirectSessionLinkEnsureResponseSchema,
        opts,
    });
}

/** 在会话所属服务器建立或续期页面 viewer；成功仅表示租约建立，不代表状态已新鲜。 */
export async function machineDirectSessionAttach(
    input: DirectSessionAttachRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionAttachResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_ATTACH,
        input,
        requestSchema: DirectSessionAttachRequestSchema,
        responseSchema: DirectSessionAttachResponseSchema,
        opts,
    });
}

/** 只释放指定页面租约；调用方必须提供创建时捕获的服务器，避免切服后误路由。 */
export async function machineDirectSessionDetach(
    input: DirectSessionDetachRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionDetachResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_DETACH,
        input,
        requestSchema: DirectSessionDetachRequestSchema,
        responseSchema: DirectSessionDetachResponseSchema,
        opts,
    });
}

export async function machineDirectSessionStatusGet(
    input: DirectSessionStatusGetRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionStatusGetResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET,
        input,
        requestSchema: DirectSessionStatusGetRequestSchema,
        responseSchema: DirectSessionStatusGetResponseSchema,
        opts,
    });
}

/** 关注由 daemon 持久化；复用所属服务器路由和已关联会话的写授权。 */
export async function machineDirectSessionFollowPolicySet(
    input: DirectSessionFollowPolicySetRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionFollowPolicySetResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_FOLLOW_POLICY_SET,
        input,
        requestSchema: DirectSessionFollowPolicySetRequestSchema,
        responseSchema: DirectSessionFollowPolicySetResponseSchema,
        authorization: { kind: 'session.write', sessionId: input.sessionId },
        opts,
    });
}

export async function machineDirectSessionTranscriptPage(
    input: DirectTranscriptPageRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectTranscriptPageResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_TRANSCRIPT_PAGE,
        input,
        requestSchema: DirectTranscriptPageRequestSchema,
        responseSchema: DirectTranscriptPageResponseSchema,
        opts,
    });
}

export async function machineDirectSessionTranscriptReadAfter(
    input: DirectTranscriptReadAfterRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectTranscriptReadAfterResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_TRANSCRIPT_READ_AFTER,
        input,
        requestSchema: DirectTranscriptReadAfterRequestSchema,
        responseSchema: DirectTranscriptReadAfterResponseSchema,
        opts,
    });
}

export async function machineDirectSessionTakeover(
    input: DirectSessionTakeoverRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionTakeoverResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER,
        input,
        requestSchema: DirectSessionTakeoverRequestSchema,
        responseSchema: DirectSessionTakeoverResponseSchema,
        opts,
    });
}

export async function machineDirectSessionTakeoverPersist(
    input: DirectSessionTakeoverPersistRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionTakeoverPersistResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId,
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER_PERSIST,
        input,
        requestSchema: DirectSessionTakeoverPersistRequestSchema,
        responseSchema: DirectSessionTakeoverPersistResponseSchema,
        opts,
    });
}

/** 从原桌面任务读取完整待处理详情，沿用关联会话写授权和原服务器作用域。 */
export async function machineDirectSessionControlRead(
    input: ZodInfer<typeof DirectSessionControlReadRequestSchema>,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionControlReadResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId, method: RPC_METHODS.DAEMON_DIRECT_SESSION_CONTROL_READ, input,
        requestSchema: DirectSessionControlReadRequestSchema, responseSchema: DirectSessionControlReadResponseSchema,
        authorization: { kind: 'session.write', sessionId: input.sessionId }, opts,
    });
}

/** 决定与运行中补充只能发出一次，未知结果保留原 operationId，禁止传输降级重投。 */
export async function machineDirectSessionControlAction(
    input: DirectSessionControlActionRequest,
    opts?: MachineDirectSessionsOpts,
): Promise<DirectSessionControlActionResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId, method: RPC_METHODS.DAEMON_DIRECT_SESSION_CONTROL_ACTION, input,
        requestSchema: DirectSessionControlActionRequestSchema, responseSchema: DirectSessionControlActionResponseSchema,
        authorization: { kind: 'session.write', sessionId: input.sessionId },
        opts: { ...opts, onIssued: () => { opts?.onIssued?.(); } },
    });
}

/** 读取所选电脑真实桌面项目配置，失败不能替换为空项目或从历史路径猜测。 */
export async function machineDirectSessionsProjectsList(input: DirectSessionsProjectsListRequest, opts?: MachineDirectSessionsOpts): Promise<DirectSessionsProjectsListResponse> {
    return callDirectSessionMachineRpc({
        machineId: input.machineId, method: RPC_METHODS.DAEMON_DIRECT_SESSIONS_PROJECTS_LIST, input,
        requestSchema: DirectSessionsProjectsListRequestSchema, responseSchema: DirectSessionsProjectsListResponseSchema, opts,
    });
}
