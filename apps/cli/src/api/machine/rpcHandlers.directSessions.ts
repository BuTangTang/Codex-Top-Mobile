import { DirectSessionsCandidateCursorError } from '@/backends/directSessions/providerOps';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
  DirectSessionAttachRequestSchema,
  DirectSessionCandidateDeleteRequestSchema,
  DirectSessionDetachRequestSchema,
  DirectSessionFollowPolicySetRequestSchema,
  DirectSessionLinkEnsureRequestSchema,
  DirectSessionSendRequestSchema,
  DirectSessionControlReadRequestSchema,
  DirectSessionControlActionRequestSchema,
  DirectSessionsProjectsListRequestSchema,
  DirectSessionStatusGetRequestSchema,
  DirectSessionTakeoverPersistRequestSchema,
  DirectSessionTakeoverRequestSchema,
  DirectSessionsAcpSessionListCapabilityRequestSchema,
  DirectSessionsCandidatesListRequestSchema,
  DirectTranscriptPageRequestSchema,
  DirectTranscriptReadAfterRequestSchema,
  normalizeCodexBackendMode,
  type DirectSessionAttachResponse,
  type DirectSessionCandidateDeleteResponse,
  type DirectSessionDetachResponse,
  type DirectSessionFollowPolicySetResponse,
  type DirectSessionTranscriptDeltaEphemeral,
  type DirectSessionLinkEnsureResponse,
  type DirectSessionStatusGetResponse,
  type DirectSessionTakeoverPersistResponse,
  type DirectSessionTakeoverResponse,
  type DirectSessionsAcpSessionListCapabilityResponse,
  type DirectSessionsCandidatesListResponse,
  type DirectTranscriptPageResponse,
  type DirectTranscriptReadAfterResponse,
  type SessionUserMessageSendResponse,
  type DirectSessionObservationV1,
} from '@happier-dev/protocol';

import { readCredentials, type Credentials } from '@/persistence';
import { isProductAccountBindingValid } from '@/auth/passwordAccountBinding';
import { decodeJwtPayload } from '@/cloud/decodeJwtPayload';
import { resolveMachineControlLocalityProof } from '@/session/machineControlLocality';
import { listSessionMarkers } from '@/daemon/sessionRegistry';
import { getDirectSessionProviderOps } from '@/backends/catalog';
import { DirectSessionsProviderUnavailableError, type DirectSessionExternalControl } from '@/backends/directSessions/providerOps';

import { importDirectSessionTranscript } from '@/api/directSessions/import/importDirectSessionTranscript';
import { createManagedDirectSessionFollowLease } from '@/api/directSessions/backgroundFollow/createManagedDirectSessionFollowLease';
import { updateSessionMetadataWithDirectSessionFollowPolicy } from '@/api/directSessions/backgroundFollow/directSessionBackgroundFollowMetadata';
import { createDirectSessionFollowLeaseManager } from '@/api/directSessions/leases/createDirectSessionFollowLeaseManager';
import { ensureDirectSessionLink } from '@/api/directSessions/linking/ensureDirectSessionLink';
import { validateDirectMachineSource } from '@/api/directSessions/security/validateDirectMachineSource';
import { findTrustedDirectSessionOwner } from '@/api/directSessions/takeover/findTrustedDirectSessionOwner';
import { loadLinkedDirectSession } from '@/api/directSessions/takeover/loadLinkedDirectSession';
import { resolveDirectTakeoverSpawnOptions } from '@/api/directSessions/takeover/resolveDirectTakeoverSpawnOptions';
import { updateSessionMetadataWithRetry } from '@/session/metadata/updateSessionMetadataWithRetry';
import { fetchSessionById, fetchSessionsPage } from '@/session/transport/http/sessionsHttp';
import { tryDecryptSessionMetadata } from '@/session/transport/encryption/sessionEncryptionContext';
import { resolveServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';
import type { ExpoPushActivityNotificationSender } from '@/activity/notifications/sendExpoPushActivityNotification';
import { directMetadataRecord, directSessionFollowGeneration, directSessionNotificationIdentity } from '@/api/directSessions/backgroundFollow/directSessionNotificationState';
import { logger } from '@/utils/logger';

import type { RpcHandlerRegistrar } from '../rpc/types';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/rpc/handlers/registerSessionHandlers';

type DirectSessionsErrorCode = 'invalid_request' | 'machine_offline' | 'provider_unavailable' | 'internal_error';

function err(
  errorCode: DirectSessionsErrorCode,
  error?: string,
): { ok: false; errorCode: DirectSessionsErrorCode; error: string } {
  return { ok: false, errorCode, error: typeof error === 'string' && error.trim() ? error : errorCode };
}

/**
 * A provider that genuinely cannot perform the operation for this source is reported as
 * `provider_unavailable`, never as an internal error and never as an empty success.
 */
function errFromProviderFailure(error: unknown, fallback: DirectSessionsErrorCode = 'internal_error'): {
  ok: false;
  errorCode: DirectSessionsErrorCode;
  error: string;
} {
  if (error instanceof DirectSessionsProviderUnavailableError) {
    return err('provider_unavailable', error.message);
  }
  return err(fallback, error instanceof Error ? error.message : 'Unknown error');
}

function requireProviderOp<TOp>(
  op: TOp | undefined,
  providerId: string,
  operation: string,
): TOp {
  if (!op) {
    throw new DirectSessionsProviderUnavailableError(
      `Agent '${providerId}' does not support direct-session ${operation} for this source.`,
    );
  }
  return op;
}

function resolveDefaultMaxBytes(): number {
  const raw = Number.parseInt(String(process.env.HAPPIER_DIRECT_SESSIONS_PAGE_MAX_BYTES ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 512_000;
  return Math.max(1024, Math.min(10 * 1024 * 1024, configured));
}

function resolveDefaultMaxItems(): number {
  const raw = Number.parseInt(String(process.env.HAPPIER_DIRECT_SESSIONS_PAGE_MAX_ITEMS ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 200;
  return Math.max(1, Math.min(5000, configured));
}

function resolveDefaultCandidatesLimit(): number {
  const raw = Number.parseInt(String(process.env.HAPPIER_DIRECT_SESSIONS_CANDIDATES_DEFAULT_LIMIT ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 50;
  return Math.max(1, Math.min(500, configured));
}

function resolveRecentActivityWindowMs(): number {
  const raw = Number.parseInt(String(process.env.HAPPIER_DIRECT_SESSIONS_RECENT_ACTIVITY_WINDOW_MS ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 15_000;
  return Math.max(1000, Math.min(60 * 60 * 1000, configured));
}

function resolveDirectSessionAttachLeaseTtlMs(requestedTtlMs: number | undefined): number {
  const raw = Number.parseInt(String(process.env.HAPPIER_DIRECT_SESSIONS_ATTACH_LEASE_TTL_MS ?? ''), 10);
  const defaultTtlMs = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 45_000;
  const configured = typeof requestedTtlMs === 'number' && Number.isFinite(requestedTtlMs) && requestedTtlMs > 0
    ? Math.trunc(requestedTtlMs)
    : defaultTtlMs;
  return Math.max(1_000, Math.min(15 * 60_000, configured));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type DirectSessionDaemonIdentity = Readonly<{ accountId: string; machineId: string }>;

/** 绑定接收 daemon 的账号和机器，复用既有归属/替换链判定，不信任客户端自报身份。 */
async function resolveExternalControlIdentity(params: Readonly<{
  credentials: Credentials;
  linkedMachineId: string;
  getDaemonIdentity?: () => Promise<DirectSessionDaemonIdentity>;
}>): Promise<
  | Readonly<{ ok: true; identity: DirectSessionDaemonIdentity }>
  | Readonly<{ ok: false; error: 'machine_mismatch' | 'not_authenticated' }>
> {
  const identity = await params.getDaemonIdentity?.();
  if (!identity?.machineId) return { ok: false, error: 'machine_mismatch' };
  if (!identity.accountId || decodeJwtPayload(params.credentials.token)?.sub !== identity.accountId) {
    return { ok: false, error: 'not_authenticated' };
  }
  const proof = await resolveMachineControlLocalityProof({
    credentials: params.credentials, sessionMachineId: params.linkedMachineId, currentMachineId: identity.machineId,
  });
  return proof ? { ok: true, identity } : { ok: false, error: 'machine_mismatch' };
}

export type DirectSessionNotificationsRuntime = Readonly<{ credentials: Credentials; expoPushSender: ExpoPushActivityNotificationSender }>;
export type DirectSessionsRpcLifecycle = Readonly<{
  reconcile: (sessionId?: string) => Promise<void>;
  suspend: () => Promise<void>;
  dispose: () => Promise<void>;
}>;

/** 注册 direct-session 操作；外部发送独立认证关联目标并保持原 owner。 */
export function registerMachineDirectSessionsRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  spawnSession?: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  stopSession?: (sessionId: string) => Promise<boolean>;
  getDaemonIdentity?: () => Promise<DirectSessionDaemonIdentity>;
  emitDirectSessionTranscriptUpdate?: (payload: DirectSessionTranscriptDeltaEphemeral) => void;
  notifications?: DirectSessionNotificationsRuntime;
}>): DirectSessionsRpcLifecycle {
  const { rpcHandlerManager, emitDirectSessionTranscriptUpdate } = params;
  const followLeaseManager = createDirectSessionFollowLeaseManager();

  const boundServerUrl = resolveServerHttpBaseUrl();
  /** 产品账号归属由单一持久化 owner 判定；旧 CLI 不启用产品模式时保留原路径。 */
  const hasProductSourceAccess = async (credentials?: Credentials): Promise<boolean> => {
    if (process.env.HAPPIER_PRODUCT_MODE !== 'codextop') return true;
    if (resolveServerHttpBaseUrl() !== boundServerUrl) return false;
    try {
      const current = credentials ?? await readCredentials();
      const accountId = current ? decodeJwtPayload(current.token)?.sub : null;
      return typeof accountId === 'string' && await isProductAccountBindingValid({ accountId, serverUrl: boundServerUrl });
    } catch { return false; }
  };
  /** 所有 direct RPC 共用账号来源门禁，列表与正文不能绕过控制端校验。 */
  const registerHandler = (method: string, handler: (raw: unknown) => Promise<unknown>): void => {
    rpcHandlerManager.registerHandler(method, async (raw: unknown) => {
      if (!await hasProductSourceAccess()) return err('provider_unavailable', 'source_account_mismatch');
      return handler(raw);
    });
  };
  const followedTargets = new Map<string, string>();
  let disposed = false;
  let epoch = 0;
  let reconciliation = Promise.resolve();
  /** 异步读取返回后先核对当前代次，旧账号或服务器的结果不能撤销新连接。 */
  const isCurrentLifecycle = (currentEpoch: number): boolean => !disposed && epoch === currentEpoch
    && resolveServerHttpBaseUrl() === boundServerUrl;

  /** 恢复与 RPC 共用同一认证关联和同一 lease manager，不从 pid marker 创建第二份关注。 */
  const reconcileSession = async (sessionId: string, currentEpoch: number): Promise<void> => {
    const runtime = params.notifications;
    if (!runtime || !isCurrentLifecycle(currentEpoch)) return;
    const linked = await loadLinkedDirectSession({ credentials: runtime.credentials, sessionId });
    if (!isCurrentLifecycle(currentEpoch)) return;
    const identity = linked.ok ? await resolveExternalControlIdentity({ credentials: runtime.credentials,
      linkedMachineId: linked.session.machineId, getDaemonIdentity: params.getDaemonIdentity }) : null;
    if (!isCurrentLifecycle(currentEpoch)) return;
    const generation = linked.ok ? directSessionFollowGeneration(linked.session.metadata) : null;
    if (!linked.ok || !identity?.ok) {
      followedTargets.delete(sessionId); await followLeaseManager.invalidateSession(sessionId); return;
    }
    const provider = await getDirectSessionProviderOps(linked.session.providerId);
    if (!isCurrentLifecycle(currentEpoch)) return;
    const source = validateDirectMachineSource({ providerId: linked.session.providerId, source: linked.session.source, env: process.env });
    if (!source.ok || !provider.acquireFollowLease) {
      followedTargets.delete(sessionId); await followLeaseManager.invalidateSession(sessionId); return;
    }
    const targetKey = directSessionNotificationIdentity({ metadata: linked.session.metadata, ...identity.identity, sessionId });
    await followLeaseManager.invalidateMismatchedTarget({ sessionId, targetKey });
    if (!isCurrentLifecycle(currentEpoch)) return;
    if (!generation) {
      followedTargets.delete(sessionId);
      await followLeaseManager.setBackgroundFollowEnabled({ sessionId, targetKey, enabled: false });
      return;
    }
    const target = targetKey + ':' + generation;
    if (followedTargets.get(sessionId) === target && followLeaseManager.hasBackgroundFollowLease(sessionId)) return;
    if (!isCurrentLifecycle(currentEpoch)) return;
    await followLeaseManager.setBackgroundFollowEnabled({ sessionId, targetKey, notificationGeneration: generation, enabled: true,
      acquireFollowLease: () => createManagedDirectSessionFollowLease({
        sessionId, reason: 'background_follow',
        notificationContext: { ...runtime, ...identity.identity, linkedMetadata: linked.session.metadata },
        acquireProviderFollowLease: (initialCursor) => provider.acquireFollowLease!({ source: source.source,
          remoteSessionId: linked.session.remoteSessionId, reason: 'background_follow', initialCursor }),
        emitDirectSessionTranscriptUpdate,
        shouldProcessBackgroundFollowEffects: () => !disposed && epoch === currentEpoch
          && resolveServerHttpBaseUrl() === boundServerUrl && followLeaseManager.isBackgroundFollowEnabled(sessionId),
      }),
    });
    if (!isCurrentLifecycle(currentEpoch)) return;
    followedTargets.set(sessionId, target);
  };

  /** 列表完整成功后才清理消失的关注；所有页面都读取，不能只扫描活跃 runner。 */
  const reconcile = (sessionId?: string): Promise<void> => {
    const currentEpoch = epoch;
    const run = async () => {
      const runtime = params.notifications;
      if (!runtime || disposed || epoch !== currentEpoch || resolveServerHttpBaseUrl() !== boundServerUrl) return;
      if (!await hasProductSourceAccess(runtime.credentials)) {
        if (isCurrentLifecycle(currentEpoch)) { epoch++; followedTargets.clear(); await followLeaseManager.invalidateAll(); }
        return;
      }
      if (sessionId) { await reconcileSession(sessionId, currentEpoch); return; }
      const identity = await params.getDaemonIdentity?.();
      if (!identity || decodeJwtPayload(runtime.credentials.token)?.sub !== identity.accountId) return;
      const seen = new Set<string>();
      let cursor: string | undefined;
      const visited = new Set<string>();
      do {
        const page = await fetchSessionsPage({ token: runtime.credentials.token, ...(cursor ? { cursor } : {}) });
        if (disposed || epoch !== currentEpoch) return;
        for (const row of page.sessions) {
          const metadata = tryDecryptSessionMetadata({ credentials: runtime.credentials, rawSession: row });
          const direct = directMetadataRecord(metadata?.directSessionV1);
          if (direct?.machineId !== identity.machineId || !metadata || !directSessionFollowGeneration(metadata)) continue;
          seen.add(row.id); await reconcileSession(row.id, currentEpoch);
        }
        if (!page.hasNext) break;
        if (!page.nextCursor || visited.has(page.nextCursor)) throw new Error('direct_follow_incomplete_scan');
        cursor = page.nextCursor; visited.add(cursor);
      } while (true);
      for (const followed of followedTargets.keys()) if (!seen.has(followed)) {
        // 停止关注仍可能有打开页面；重新核对关联后停通知，删除或换源才撤销 viewer。
        await reconcileSession(followed, currentEpoch);
      }
    };
    const next = reconciliation.then(run, run);
    reconciliation = next.catch(() => {});
    return next;
  };

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_ATTACH, async (raw: unknown) => {
    const currentEpoch = epoch;
    const parsed = DirectSessionAttachRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectSessionAttachResponse;
    const validatedSource = validateDirectMachineSource({
      providerId: parsed.data.providerId,
      source: parsed.data.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectSessionAttachResponse;
    }

    try {
      const providerOps = await getDirectSessionProviderOps(parsed.data.providerId);
      let targetKey: string | undefined;
      let source = validatedSource.source;
      // 外部状态仅能来自已认证关联。其余提供方保留原有纯正文 viewer 行为。
      if (providerOps.getExternalControl) {
        const credentials = await readCredentials().catch(() => null);
        if (!credentials) return err('provider_unavailable', 'not_authenticated');
        const linked = await loadLinkedDirectSession({ credentials, sessionId: parsed.data.sessionId, machineId: parsed.data.machineId });
        if (!isCurrentLifecycle(currentEpoch)) return err('provider_unavailable', 'source_unavailable');
        if (!linked.ok) return err(linked.errorCode, linked.error);
        if (linked.session.providerId !== parsed.data.providerId || linked.session.remoteSessionId !== parsed.data.remoteSessionId) {
          return err('invalid_request', 'source_mismatch');
        }
        const identity = await resolveExternalControlIdentity({ credentials, linkedMachineId: linked.session.machineId, getDaemonIdentity: params.getDaemonIdentity });
        if (!identity.ok) return err('invalid_request', identity.error);
        const linkedSource = validateDirectMachineSource({ providerId: linked.session.providerId, source: linked.session.source, env: process.env });
        if (!linkedSource.ok) return err('invalid_request', 'source_mismatch');
        const control = await providerOps.getExternalControl({ source: linkedSource.source, requestedSource: source, remoteSessionId: linked.session.remoteSessionId });
        if (!isCurrentLifecycle(currentEpoch)) return err('provider_unavailable', 'source_unavailable');
        if (control.unavailableReason === 'source_mismatch' || control.unavailableReason === 'source_unavailable') {
          return err('invalid_request', control.unavailableReason);
        }
        source = linkedSource.source;
        targetKey = directSessionNotificationIdentity({ metadata: linked.session.metadata, ...identity.identity, sessionId: parsed.data.sessionId });
        await followLeaseManager.invalidateMismatchedTarget({ sessionId: parsed.data.sessionId, targetKey });
      }
      if (!isCurrentLifecycle(currentEpoch)) return err('provider_unavailable', 'source_unavailable');
      const attached = await followLeaseManager.attach({
        sessionId: parsed.data.sessionId,
        targetKey,
        leaseId: parsed.data.leaseId,
        ttlMs: resolveDirectSessionAttachLeaseTtlMs(parsed.data.ttlMs),
        acquireFollowLease: providerOps.acquireFollowLease
          ? async () => createManagedDirectSessionFollowLease({
            sessionId: parsed.data.sessionId,
            reason: 'attached_view',
            acquireProviderFollowLease: () => providerOps.acquireFollowLease!({
              source,
              remoteSessionId: parsed.data.remoteSessionId,
              reason: 'attached_view',
            }),
            emitDirectSessionTranscriptUpdate,
            shouldProcessBackgroundFollowEffects: () => false,
          })
          : undefined,
      });
      if (!isCurrentLifecycle(currentEpoch)) return err('provider_unavailable', 'source_unavailable');
      return {
        ok: true,
        leaseId: attached.leaseId,
        expiresAtMs: attached.expiresAtMs,
        renewed: attached.renewed,
      } satisfies DirectSessionAttachResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err('internal_error', message) satisfies DirectSessionAttachResponse;
    }
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_DETACH, async (raw: unknown) => {
    const parsed = DirectSessionDetachRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectSessionDetachResponse;
    const detached = await followLeaseManager.detach({
      sessionId: parsed.data.sessionId,
      leaseId: parsed.data.leaseId,
    });
    return {
      ok: true,
      detached: detached.detached,
    } satisfies DirectSessionDetachResponse;
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_FOLLOW_POLICY_SET, async (raw: unknown) => {
    const parsed = DirectSessionFollowPolicySetRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectSessionFollowPolicySetResponse;
    const validatedSource = validateDirectMachineSource({
      providerId: parsed.data.providerId,
      source: parsed.data.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectSessionFollowPolicySetResponse;
    }

    const runtime = params.notifications;
    if (!runtime) return err('provider_unavailable', 'notification_runtime_unavailable') satisfies DirectSessionFollowPolicySetResponse;
    try {
      const linked = await loadLinkedDirectSession({ credentials: runtime.credentials, sessionId: parsed.data.sessionId, machineId: parsed.data.machineId });
      if (!linked.ok) return err(linked.errorCode, linked.error) satisfies DirectSessionFollowPolicySetResponse;
      const identity = await resolveExternalControlIdentity({ credentials: runtime.credentials,
        linkedMachineId: linked.session.machineId, getDaemonIdentity: params.getDaemonIdentity });
      if (!identity.ok) return err('invalid_request', identity.error) satisfies DirectSessionFollowPolicySetResponse;
      if (linked.session.providerId !== parsed.data.providerId || linked.session.remoteSessionId !== parsed.data.remoteSessionId) {
        return err('invalid_request', 'source_mismatch') satisfies DirectSessionFollowPolicySetResponse;
      }
      const direct = directMetadataRecord(linked.session.metadata.directSessionV1);
      const linkedSource = validateDirectMachineSource({ providerId: linked.session.providerId, source: linked.session.source, env: process.env });
      if (!linkedSource.ok) return err('invalid_request', 'source_mismatch') satisfies DirectSessionFollowPolicySetResponse;
      const requestedMetadata = { ...linked.session.metadata, directSessionV1: { ...direct, source: validatedSource.source } };
      const canonicalMetadata = { ...linked.session.metadata, directSessionV1: { ...direct, source: linkedSource.source } };
      const scope = { ...identity.identity, sessionId: parsed.data.sessionId };
      if (directSessionNotificationIdentity({ ...scope, metadata: requestedMetadata })
          !== directSessionNotificationIdentity({ ...scope, metadata: canonicalMetadata })) {
        return err('invalid_request', 'source_mismatch') satisfies DirectSessionFollowPolicySetResponse;
      }
      const provider = await getDirectSessionProviderOps(linked.session.providerId);
      if (parsed.data.enabled && (!provider.acquireFollowLease)) {
        return err('provider_unavailable', 'explicit_lifecycle_not_supported') satisfies DirectSessionFollowPolicySetResponse;
      }
      const updatedAtMs = Date.now();
      // 先持久化策略成功，再取得观察 lease，避免失败的订阅也在后台发送。
      await updateSessionMetadataWithDirectSessionFollowPolicy({ token: runtime.credentials.token, credentials: runtime.credentials,
        sessionId: parsed.data.sessionId, rawSession: linked.session.rawSession,
        policy: parsed.data.enabled ? 'background_follow' : 'attached_only', updatedAtMs });
      await reconcile(parsed.data.sessionId);
      return { ok: true, enabled: parsed.data.enabled,
        leaseActive: followLeaseManager.hasBackgroundFollowLease(parsed.data.sessionId), updatedAtMs,
        ...(provider.supportsExplicitLifecycleNotifications ? { notifications: { capability: 'explicit_lifecycle_v1' as const, enabled: parsed.data.enabled } } : {}),
      } satisfies DirectSessionFollowPolicySetResponse;
    } catch {
      return err('internal_error', 'follow_policy_set_failed') satisfies DirectSessionFollowPolicySetResponse;
    }
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSIONS_ACP_SESSION_LIST_CAPABILITY_GET, async (raw: unknown) => {
    const parsed = DirectSessionsAcpSessionListCapabilityRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request');
    return {
      ok: true,
      capability: 'acp_session_list_v1',
      protocolVersion: 1,
      sourceKind: 'acpSessionList',
      resumeOnly: true,
    } satisfies DirectSessionsAcpSessionListCapabilityResponse;
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSIONS_CANDIDATES_LIST, async (raw: unknown) => {
    const parsed = DirectSessionsCandidatesListRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectSessionsCandidatesListResponse;
    const validatedSource = validateDirectMachineSource({
      providerId: parsed.data.providerId,
      source: parsed.data.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectSessionsCandidatesListResponse;
    }
    const { providerId, cursor, searchTerm, searchMode } = parsed.data;
    const source = validatedSource.source;

    const limit = parsed.data.limit ?? resolveDefaultCandidatesLimit();
    const startedAtMs = Date.now();
    const startMemory = process.memoryUsage();
    try {
      const res = await (await getDirectSessionProviderOps(providerId)).listCandidates({ source, cursor, limit, searchTerm, searchMode });
      logger.debug('[directSessions.rpc.candidates] list finished', {
        providerId,
        elapsedMs: Date.now() - startedAtMs,
        searchTermLength: typeof searchTerm === 'string' ? searchTerm.trim().length : 0,
        searchMode: searchMode ?? 'default',
        cursorPresent: Boolean(cursor),
        limit,
        returnedCandidates: res.candidates.length,
        hasNextCursor: Boolean(res.nextCursor),
        searchIncomplete: Boolean(res.searchIncomplete),
        heapDeltaBytes: process.memoryUsage().heapUsed - startMemory.heapUsed,
        rssBytes: process.memoryUsage().rss,
      });
      return {
        ok: true,
        candidates: res.candidates,
        nextCursor: res.nextCursor,
        ...(res.searchIncomplete ? { searchIncomplete: true } : {}),
        ...(res.capabilities ? { capabilities: res.capabilities } : {}),
      } satisfies DirectSessionsCandidatesListResponse;
    } catch (error) {
      if (error instanceof DirectSessionsCandidateCursorError) {
        return { ...err('invalid_request', error.message), refreshRequired: true } satisfies DirectSessionsCandidatesListResponse;
      }
      return errFromProviderFailure(error) satisfies DirectSessionsCandidatesListResponse;
    }
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_DELETE, async (raw: unknown) => {
    const parsed = DirectSessionCandidateDeleteRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectSessionCandidateDeleteResponse;
    const validatedSource = validateDirectMachineSource({
      providerId: parsed.data.providerId,
      source: parsed.data.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectSessionCandidateDeleteResponse;
    }

    try {
      const providerOps = await getDirectSessionProviderOps(parsed.data.providerId);
      await requireProviderOp(providerOps.deleteCandidate, parsed.data.providerId, 'candidate deletion')({
        source: validatedSource.source,
        remoteSessionId: parsed.data.remoteSessionId,
      });
      return { ok: true, deleted: true } satisfies DirectSessionCandidateDeleteResponse;
    } catch (error) {
      return errFromProviderFailure(error) satisfies DirectSessionCandidateDeleteResponse;
    }
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE, async (raw: unknown) => {
    const parsed = DirectSessionLinkEnsureRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectSessionLinkEnsureResponse;
    const validatedSource = validateDirectMachineSource({
      providerId: parsed.data.providerId,
      source: parsed.data.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectSessionLinkEnsureResponse;
    }

    const credentials = await readCredentials().catch(() => null);
    if (!credentials) {
      return err('provider_unavailable', 'not_authenticated') satisfies DirectSessionLinkEnsureResponse;
    }

    try {
      // A linked direct session is rendered from the provider's transcript; a resume-only source
      // (ACP session/list) has none, so linking it would create a session Happier cannot show.
      const linkOps = await getDirectSessionProviderOps(parsed.data.providerId);
      requireProviderOp(linkOps.pageTranscript, parsed.data.providerId, 'linking');
      const codexBackendMode = normalizeCodexBackendMode(parsed.data.codexBackendMode) ?? undefined;
      const res = await ensureDirectSessionLink({
        credentials,
        machineId: parsed.data.machineId,
        providerId: parsed.data.providerId,
        remoteSessionId: parsed.data.remoteSessionId,
        codexBackendMode,
        runtimeDescriptor: parsed.data.runtimeDescriptor,
        titleHint: parsed.data.titleHint,
        directoryHint: parsed.data.directoryHint,
        source: validatedSource.source,
      });
      return { ok: true, sessionId: res.sessionId, created: res.created } satisfies DirectSessionLinkEnsureResponse;
    } catch (error) {
      return errFromProviderFailure(error) satisfies DirectSessionLinkEnsureResponse;
    }
  });

  /** 只读取所选电脑的真实项目，原生创建能力未证实时明确返回不可用。 */
  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSIONS_PROJECTS_LIST, async (raw: unknown) => {
    const parsed = DirectSessionsProjectsListRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request');
    try {
      const credentials = await readCredentials().catch(() => null);
      if (!credentials) return err('provider_unavailable', 'not_authenticated');
      const identity = await resolveExternalControlIdentity({ credentials, linkedMachineId: parsed.data.machineId, getDaemonIdentity: params.getDaemonIdentity });
      if (!identity.ok) return err('provider_unavailable', identity.error);
      const source = validateDirectMachineSource({ providerId: parsed.data.providerId, source: parsed.data.source, env: process.env });
      if (!source.ok) return err('invalid_request');
      const provider = await getDirectSessionProviderOps(parsed.data.providerId);
      if (!provider.listProjects) return err('provider_unavailable');
      return { ok: true, projects: await provider.listProjects({ source: source.source }), nativeCreate: false, unavailableReason: 'desktop_native_create_unavailable' };
    } catch (error) { return errFromProviderFailure(error); }
  });

  // 新发送入口只接受 Happier 关联 ID；原生 ID 与来源必须从当前账号的关联读取。
  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND, async (raw: unknown): Promise<SessionUserMessageSendResponse> => {
    const parsed = DirectSessionSendRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'invalid_request', errorCode: 'invalid_request' };
    let submissionStarted = false;
    try {
      const credentials = await readCredentials().catch(() => null);
      if (!credentials) return { ok: false, error: 'not_authenticated', errorCode: 'not_authenticated' };
      const linked = await loadLinkedDirectSession({
        credentials, sessionId: parsed.data.sessionId, machineId: parsed.data.machineId,
      });
      if (!linked.ok) return { ok: false, error: linked.error, errorCode: linked.error };
      const identity = await resolveExternalControlIdentity({
        credentials, linkedMachineId: linked.session.machineId, getDaemonIdentity: params.getDaemonIdentity,
      });
      if (!identity.ok) return { ok: false, error: identity.error, errorCode: identity.error };
      const validatedSource = validateDirectMachineSource({
        providerId: linked.session.providerId, source: linked.session.source, env: process.env,
      });
      if (!validatedSource.ok) return { ok: false, error: 'invalid_request', errorCode: 'invalid_request' };
      const provider = await getDirectSessionProviderOps(linked.session.providerId);
      if (!provider.send) return { ok: false, error: 'provider_unavailable', errorCode: 'provider_unavailable' };
      submissionStarted = true;
      const result = await provider.send({ source: validatedSource.source, remoteSessionId: linked.session.remoteSessionId,
        text: parsed.data.text, localId: parsed.data.localId, meta: parsed.data.meta, accountId: identity.identity.accountId });
      if (result.status === 'accepted') return { ok: true };
      const reason = result.status === 'unknown' ? 'delivery_outcome_unknown' : result.reason;
      return { ok: false, error: reason, errorCode: reason };
    } catch {
      // provider 调用开始后的异常可能发生在已投递之后，不能宣布安全重试。
      const reason = submissionStarted ? 'delivery_outcome_unknown' : 'internal_error';
      return { ok: false, error: reason, errorCode: reason };
    }
  });

  /** 读取和决定沿同一认证关联定位，不接受手机提供的原生任务或来源覆盖。 */
  const handleDesktopControl = async (raw: unknown, actionRequested: boolean): Promise<unknown> => {
    // 保留动作 schema 的成功结果，后续不能只凭公共目标上的 kind 属性推断已验证的动作。
    const action = actionRequested ? DirectSessionControlActionRequestSchema.safeParse(raw) : null;
    const parsed = action ?? DirectSessionControlReadRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request');
    let submissionStarted = false;
    try {
      const credentials = await readCredentials().catch(() => null);
      if (!credentials) return err('provider_unavailable', 'not_authenticated');
      const linked = await loadLinkedDirectSession({ credentials, sessionId: parsed.data.sessionId, machineId: parsed.data.machineId });
      if (!linked.ok) return err('provider_unavailable', linked.error);
      const identity = await resolveExternalControlIdentity({ credentials, linkedMachineId: linked.session.machineId, getDaemonIdentity: params.getDaemonIdentity });
      if (!identity.ok) return err('provider_unavailable', identity.error);
      const source = validateDirectMachineSource({ providerId: linked.session.providerId, source: linked.session.source, env: process.env });
      if (!source.ok) return err('invalid_request');
      const provider = await getDirectSessionProviderOps(linked.session.providerId);
      const target = { source: source.source, remoteSessionId: linked.session.remoteSessionId };
      if (action?.success) {
        if (!provider.control) return err('provider_unavailable');
        submissionStarted = true;
        return { ok: true, result: await provider.control({ ...target, accountId: identity.identity.accountId, action: action.data }) };
      }
      if (!provider.readControl) return err('provider_unavailable');
      return { ok: true, snapshot: await provider.readControl(target) };
    } catch {
      return submissionStarted ? { ok: true, result: { status: 'unknown', reason: 'delivery_outcome_unknown' } } : err('provider_unavailable', 'desktop_control_unavailable');
    }
  };
  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_CONTROL_READ, (raw) => handleDesktopControl(raw, false));
  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_CONTROL_ACTION, (raw) => handleDesktopControl(raw, true));

  // 状态读取继续保留现有 activity 语义；外部发送能力只由匹配关联的实际 owner 探测授予。
  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET, async (raw: unknown) => {
    const currentEpoch = epoch;
    const parsed = DirectSessionStatusGetRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectSessionStatusGetResponse;
    const validatedSource = validateDirectMachineSource({
      providerId: parsed.data.providerId,
      source: parsed.data.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectSessionStatusGetResponse;
    }
    const nowMs = Date.now();
    const recentWindowMs = resolveRecentActivityWindowMs();
    let activityValue: 'running' | 'active_recently' | 'idle' | 'unknown' = 'unknown';
    let lastKnownActivityAtMs: number | undefined = undefined;
    let runnerActive = false;
    let trustedPid: number | null = null;
    let canForceStop = false;
    let observation: DirectSessionObservationV1 | undefined;
    let notifications: { capability: 'explicit_lifecycle_v1'; enabled: boolean; delivery?: 'submitted' | 'not_submitted' | 'unknown' } | undefined;

    const markers = await listSessionMarkers().catch(() => []);
    const liveMarkers = markers.filter((m) => Number.isFinite(m.pid) && m.pid > 0 && isPidAlive(m.pid));

    runnerActive = liveMarkers.some((m) => m.happySessionId === parsed.data.sessionId);

    if (!runnerActive) {
      const owner = findTrustedDirectSessionOwner({
        markers: liveMarkers,
        providerId: parsed.data.providerId,
        remoteSessionId: parsed.data.remoteSessionId,
        isPidAlive,
      });
      if (owner) {
        trustedPid = owner.pid;
        canForceStop = true;
      }
    }

    try {
      const activityOps = await getDirectSessionProviderOps(parsed.data.providerId);
      const res = await requireProviderOp(activityOps.getActivity, parsed.data.providerId, 'activity')({
        source: validatedSource.source,
        remoteSessionId: parsed.data.remoteSessionId,
      });
      if (typeof res.lastActivityAtMs === 'number' && Number.isFinite(res.lastActivityAtMs) && res.lastActivityAtMs >= 0) {
        lastKnownActivityAtMs = res.lastActivityAtMs;
        const ageMs = nowMs - res.lastActivityAtMs;
        activityValue = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= recentWindowMs ? 'active_recently' : 'idle';
      }
      observation = res.observation ?? (activityOps.getExternalControl ? { v: 1, state: 'unknown', reason: 'not_observed' } : undefined);
      if (res.isRunning) {
        activityValue = 'running';
      }
    } catch {
      activityValue = 'unknown';
    }

    if (runnerActive) {
      activityValue = 'running';
    }

    let canTakeOverPersist = true;
    let externalControl: DirectSessionExternalControl | undefined;
    try {
      const credentials = await readCredentials().catch(() => null);
      if (!credentials) {
        canTakeOverPersist = false;
      } else {
        const linked = await loadLinkedDirectSession({
          credentials,
          sessionId: parsed.data.sessionId,
          machineId: parsed.data.machineId,
        });
        if (!isCurrentLifecycle(currentEpoch)) return err('provider_unavailable', 'source_unavailable');
        if (!linked.ok) {
          canTakeOverPersist = false;
        } else {
          if (linked.session.providerId === parsed.data.providerId && linked.session.remoteSessionId === parsed.data.remoteSessionId) {
            const linkedSource = validateDirectMachineSource({
              providerId: linked.session.providerId, source: linked.session.source, env: process.env,
            });
            if (linkedSource.ok) {
              try {
                const provider = await getDirectSessionProviderOps(linked.session.providerId);
                if (provider.getExternalControl) {
                  observation = { v: 1, state: 'unknown', reason: 'not_observed' };
                  const identity = await resolveExternalControlIdentity({
                    credentials, linkedMachineId: linked.session.machineId, getDaemonIdentity: params.getDaemonIdentity,
                  });
                  if (!isCurrentLifecycle(currentEpoch)) return err('provider_unavailable', 'source_unavailable');
                  externalControl = { canSend: false, unavailableReason: identity.ok ? 'provider_unavailable' : identity.error };
                  if (identity.ok) {
                    const target = { sessionId: parsed.data.sessionId, targetKey: directSessionNotificationIdentity({
                      metadata: linked.session.metadata, ...identity.identity, sessionId: parsed.data.sessionId,
                    }) };
                    await followLeaseManager.invalidateMismatchedTarget(target);
                    if (!isCurrentLifecycle(currentEpoch)) return err('provider_unavailable', 'source_unavailable');
                    try {
                      externalControl = await provider.getExternalControl({ source: linkedSource.source,
                        requestedSource: validatedSource.source, remoteSessionId: linked.session.remoteSessionId });
                    } catch { /* 能力探测失败不覆盖另一条仍有效的只读观察。 */ }
                    if (isCurrentLifecycle(currentEpoch)
                        && externalControl.unavailableReason !== 'source_mismatch' && externalControl.unavailableReason !== 'source_unavailable') {
                      observation = followLeaseManager.getObservation(target);
                    }
                    if (observation?.state === 'running' || observation?.state === 'needs_input') activityValue = 'running';
                    if (observation?.state === 'completed' || observation?.state === 'failed' || observation?.state === 'cancelled') activityValue = 'idle';
                    if (provider.supportsExplicitLifecycleNotifications && params.notifications) {
                      notifications = { capability: 'explicit_lifecycle_v1', enabled: directSessionFollowGeneration(linked.session.metadata) !== null,
                        delivery: followLeaseManager.getBackgroundFollowLease(parsed.data.sessionId)?.getNotificationDelivery?.() };
                    }
                  }
                }
              } catch {
                externalControl = { canSend: false, unavailableReason: 'provider_unavailable' };
              }
            }
          }
          const takeoverOptions = await resolveDirectTakeoverSpawnOptions({
            linked: linked.session,
            sessionId: parsed.data.sessionId,
          });
          canTakeOverPersist = takeoverOptions !== null;
        }
      }
    } catch {
      canTakeOverPersist = false;
    }

    if (!isCurrentLifecycle(currentEpoch)) return err('provider_unavailable', 'source_unavailable');
    return {
      ok: true,
      machineOnline: true,
      runnerActive,
      activity: activityValue,
      ...(observation ? { observation } : {}),
      ...(notifications ? { notifications } : {}),
      canTakeOverDirect: !runnerActive,
      canTakeOverPersist,
      canForceStop,
      trustedPid,
      ...(externalControl ? { externalControl } : {}),
      ...(lastKnownActivityAtMs !== undefined ? { lastKnownActivityAtMs } : {}),
    } satisfies DirectSessionStatusGetResponse;
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_TRANSCRIPT_PAGE, async (raw: unknown) => {
    const parsed = DirectTranscriptPageRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectTranscriptPageResponse;
    const validatedSource = validateDirectMachineSource({
      providerId: parsed.data.providerId,
      source: parsed.data.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectTranscriptPageResponse;
    }
    const { providerId, remoteSessionId, direction, cursor } = parsed.data;
    const source = validatedSource.source;
    const maxBytes = parsed.data.maxBytes ?? resolveDefaultMaxBytes();
    const maxItems = parsed.data.maxItems ?? resolveDefaultMaxItems();

    try {
      const pageOps = await getDirectSessionProviderOps(providerId);
      const res = await requireProviderOp(pageOps.pageTranscript, providerId, 'transcript paging')({
        source,
        remoteSessionId,
        direction,
        cursor,
        maxBytes,
        maxItems,
      });
      return {
        ok: true,
        items: res.items,
        nextCursor: res.nextCursor,
        tailCursor: res.tailCursor,
        hasMore: res.hasMore,
        ...(res.historyAvailability ? { historyAvailability: res.historyAvailability } : {}),
        truncated: res.truncated,
        ...(res.truncationReason ? { truncationReason: res.truncationReason } : {}),
      } satisfies DirectTranscriptPageResponse;
    } catch (error) {
      return errFromProviderFailure(error) satisfies DirectTranscriptPageResponse;
    }
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_TRANSCRIPT_READ_AFTER, async (raw: unknown) => {
    const parsed = DirectTranscriptReadAfterRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectTranscriptReadAfterResponse;
    const validatedSource = validateDirectMachineSource({
      providerId: parsed.data.providerId,
      source: parsed.data.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectTranscriptReadAfterResponse;
    }
    const { providerId, remoteSessionId, cursor } = parsed.data;
    const source = validatedSource.source;

    const maxBytes = parsed.data.maxBytes ?? resolveDefaultMaxBytes();
    const maxItems = parsed.data.maxItems ?? resolveDefaultMaxItems();

    try {
      const readAfterOps = await getDirectSessionProviderOps(providerId);
      const res = await requireProviderOp(readAfterOps.readAfterTranscript, providerId, 'transcript paging')({
        source,
        remoteSessionId,
        cursor,
        maxBytes,
        maxItems,
      });
      return { ok: true, ...res } satisfies DirectTranscriptReadAfterResponse;
    } catch (error) {
      return errFromProviderFailure(error) satisfies DirectTranscriptReadAfterResponse;
    }
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER, async (raw: unknown) => {
    const parsed = DirectSessionTakeoverRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectSessionTakeoverResponse;
    if (!params.spawnSession || !params.stopSession) {
      return err('provider_unavailable', 'takeover_not_supported') satisfies DirectSessionTakeoverResponse;
    }

    const credentials = await readCredentials().catch(() => null);
    if (!credentials) {
      return err('provider_unavailable', 'not_authenticated') satisfies DirectSessionTakeoverResponse;
    }

    const linked = await loadLinkedDirectSession({
      credentials,
      sessionId: parsed.data.sessionId,
      machineId: parsed.data.machineId,
    });
    if (!linked.ok) {
      return err(linked.errorCode, linked.error) satisfies DirectSessionTakeoverResponse;
    }
    const validatedSource = validateDirectMachineSource({
      providerId: linked.session.providerId,
      source: linked.session.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectSessionTakeoverResponse;
    }
    const validatedLinkedSession = {
      ...linked.session,
      source: validatedSource.source,
    };

    const markers = await listSessionMarkers().catch(() => []);
    const trustedOwner = findTrustedDirectSessionOwner({
      markers,
      providerId: validatedLinkedSession.providerId,
      remoteSessionId: validatedLinkedSession.remoteSessionId,
      isPidAlive,
    });

    if (trustedOwner && trustedOwner.happySessionId === parsed.data.sessionId) {
      return { ok: true } satisfies DirectSessionTakeoverResponse;
    }

    if (trustedOwner && parsed.data.forceStop !== true) {
      return err('invalid_request', 'force_stop_required') satisfies DirectSessionTakeoverResponse;
    }

    if (trustedOwner && parsed.data.forceStop === true) {
      const stopped = await params.stopSession(trustedOwner.happySessionId);
      if (!stopped) {
        return err('internal_error', 'trusted_process_stop_failed') satisfies DirectSessionTakeoverResponse;
      }
    }

    const spawnOptions = await resolveDirectTakeoverSpawnOptions({
      linked: validatedLinkedSession,
      sessionId: parsed.data.sessionId,
    });
    if (!spawnOptions) {
      return err('invalid_request', 'direct_session_directory_unavailable') satisfies DirectSessionTakeoverResponse;
    }

    const spawnResult = await params.spawnSession(spawnOptions);
    if (spawnResult.type !== 'success') {
      return err(
        'internal_error',
        spawnResult.type === 'error' ? spawnResult.errorMessage : 'directory_approval_required',
      ) satisfies DirectSessionTakeoverResponse;
    }

    return { ok: true } satisfies DirectSessionTakeoverResponse;
  });

  registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER_PERSIST, async (raw: unknown) => {
    const parsed = DirectSessionTakeoverPersistRequestSchema.safeParse(raw);
    if (!parsed.success) return err('invalid_request') satisfies DirectSessionTakeoverPersistResponse;
    if (!params.spawnSession || !params.stopSession) {
      return err('provider_unavailable', 'takeover_not_supported') satisfies DirectSessionTakeoverPersistResponse;
    }

    const credentials = await readCredentials().catch(() => null);
    if (!credentials) {
      return err('provider_unavailable', 'not_authenticated') satisfies DirectSessionTakeoverPersistResponse;
    }

    const linked = await loadLinkedDirectSession({
      credentials,
      sessionId: parsed.data.sessionId,
      machineId: parsed.data.machineId,
    });
    if (!linked.ok) {
      return err(linked.errorCode, linked.error) satisfies DirectSessionTakeoverPersistResponse;
    }
    const validatedSource = validateDirectMachineSource({
      providerId: linked.session.providerId,
      source: linked.session.source,
      env: process.env,
    });
    if (!validatedSource.ok) {
      return err('invalid_request', validatedSource.error) satisfies DirectSessionTakeoverPersistResponse;
    }
    const validatedLinkedSession = {
      ...linked.session,
      source: validatedSource.source,
    };

    const markers = await listSessionMarkers().catch(() => []);
    const trustedOwner = findTrustedDirectSessionOwner({
      markers,
      providerId: validatedLinkedSession.providerId,
      remoteSessionId: validatedLinkedSession.remoteSessionId,
      isPidAlive,
    });

    if (trustedOwner && trustedOwner.happySessionId !== parsed.data.sessionId && parsed.data.forceStop !== true) {
      return err('invalid_request', 'force_stop_required') satisfies DirectSessionTakeoverPersistResponse;
    }

    if (trustedOwner && trustedOwner.happySessionId !== parsed.data.sessionId && parsed.data.forceStop === true) {
      const stopped = await params.stopSession(trustedOwner.happySessionId);
      if (!stopped) {
        return err('internal_error', 'trusted_process_stop_failed') satisfies DirectSessionTakeoverPersistResponse;
      }
    }

    const directSpawnOptions = await resolveDirectTakeoverSpawnOptions({
      linked: validatedLinkedSession,
      sessionId: parsed.data.sessionId,
    });
    if (!directSpawnOptions) {
      return err('invalid_request', 'direct_session_directory_unavailable') satisfies DirectSessionTakeoverPersistResponse;
    }

    try {
      await importDirectSessionTranscript({
        linked: validatedLinkedSession,
        credentials,
        sessionId: parsed.data.sessionId,
        workingDirectory: directSpawnOptions.directory,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'direct_session_import_failed';
      return err('internal_error', message) satisfies DirectSessionTakeoverPersistResponse;
    }

    const persistedSpawnOptions: SpawnSessionOptions = {
      ...directSpawnOptions,
      transcriptStorage: 'persisted',
    };
    const spawnResult = await params.spawnSession(persistedSpawnOptions);
    if (spawnResult.type !== 'success') {
      return err(
        'internal_error',
        spawnResult.type === 'error' ? spawnResult.errorMessage : 'directory_approval_required',
      ) satisfies DirectSessionTakeoverPersistResponse;
    }

    await updateSessionMetadataWithRetry({
      token: credentials.token,
      credentials,
      sessionId: parsed.data.sessionId,
      rawSession: linked.session.rawSession,
      updater: (current) => {
        const next: Record<string, unknown> = { ...current };
        delete next.directSessionV1;
        if (typeof next.path !== 'string' || !next.path.trim()) {
          next.path = directSpawnOptions.directory;
        }
        next.externalHistoryImportV1 = {
          v: 1,
          providerId: validatedLinkedSession.providerId,
          remoteSessionId: validatedLinkedSession.remoteSessionId,
          importedAtMs: Date.now(),
          source: validatedLinkedSession.source,
        };
        return next;
      },
    });

    return { ok: true, converted: true } satisfies DirectSessionTakeoverPersistResponse;
  });
  return {
    reconcile,
    suspend: async () => {
      epoch++;
      followedTargets.clear();
      await followLeaseManager.invalidateAll();
      await reconciliation;
    },
    dispose: async () => {
      disposed = true; epoch++; followedTargets.clear();
      await followLeaseManager.dispose(); await reconciliation;
    },
  };

}
