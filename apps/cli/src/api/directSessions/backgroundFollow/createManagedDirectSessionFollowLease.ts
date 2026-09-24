import { randomUUID } from 'node:crypto';
import type { DirectSessionTranscriptDeltaEphemeral, DirectTranscriptRawMessageV1, DirectTranscriptTruncationReason, DirectSessionObservationV1 } from '@happier-dev/protocol';
import { DirectSessionObservationV1Schema, resolveDirectTranscriptContinuation } from '@happier-dev/protocol';
import { dispatchActivityNotificationAsync } from '@/activity/notifications/dispatchActivityNotification';
import type { ExpoPushActivityNotificationSender } from '@/activity/notifications/sendExpoPushActivityNotification';
import type { Credentials } from '@/persistence';
import type { Metadata } from '@/api/types';
import { getActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveAccountSettingsScopeKey } from '@/settings/accountSettings/accountSettingsScopeKey';
import { fetchSessionById } from '@/session/transport/http/sessionsHttp';
import { tryDecryptSessionMetadata } from '@/session/transport/encryption/sessionEncryptionContext';
import { updateSessionMetadataWithRetry } from '@/session/metadata/updateSessionMetadataWithRetry';
import { deriveDirectSessionObservedProgress, updateMetadataWithDirectSessionObservedProgress } from './directSessionBackgroundFollowMetadata';
import { directMetadataRecord, directSessionFollowGeneration, directSessionNotificationIdentity,
  readDirectSessionNotificationState, reduceDirectSessionNotificationObservation, checkpointDirectSessionNotificationState } from './directSessionNotificationState';

export type DirectSessionFollowLeaseReason = 'attached_view' | 'background_follow';
/** 连续事件与首次/重连快照分开，不能要求短任务必定先被观察到 running。 */
export type DirectSessionObservationFact = Readonly<{ observation: DirectSessionObservationV1; continuity: 'snapshot' | 'event' }>;
export type DirectSessionTranscriptUpdate = Readonly<{
  items: Iterable<DirectTranscriptRawMessageV1>;
  fromCursor?: string | null;
  nextCursor?: string | null;
  truncated: boolean;
  truncationReason?: DirectTranscriptTruncationReason;
  observations?: readonly DirectSessionObservationFact[];
}>;
export type DirectSessionTranscriptUpdateListener = (update: DirectSessionTranscriptUpdate) => void | Promise<void>;
export type DirectSessionFollowLease = Readonly<{
  release: () => void | Promise<void>;
  getTailCursor?: () => string | null;
  getObservation?: () => DirectSessionObservationV1;
  getNotificationDelivery?: () => 'submitted' | 'not_submitted' | 'unknown' | undefined;
  subscribeToTranscriptUpdates?: (listener: DirectSessionTranscriptUpdateListener) => () => void;
}>;
export type DirectSessionNotificationContext = Readonly<{
  credentials: Credentials;
  accountId: string;
  machineId: string;
  linkedMetadata: Record<string, unknown>;
  expoPushSender: ExpoPushActivityNotificationSender;
}>;

/** 固定认证身份后沿用同一个提供方 lease、元数据 CAS 和通知 dispatcher。 */
export async function createManagedDirectSessionFollowLease(params: Readonly<{
  sessionId: string;
  reason: DirectSessionFollowLeaseReason;
  acquireProviderFollowLease: (initialCursor?: string) => Promise<DirectSessionFollowLease | null>;
  emitDirectSessionTranscriptUpdate?: (payload: DirectSessionTranscriptDeltaEphemeral) => void | Promise<void>;
  shouldProcessBackgroundFollowEffects: () => boolean;
  notificationContext?: DirectSessionNotificationContext;
}>): Promise<DirectSessionFollowLease | null> {
  const context = params.notificationContext;
  const identityParams = context ? { accountId: context.accountId, machineId: context.machineId, sessionId: params.sessionId } : null;
  const identity = context && identityParams ? directSessionNotificationIdentity({ ...identityParams, metadata: context.linkedMetadata }) : '';
  const generation = context ? directSessionFollowGeneration(context.linkedMetadata) : null;
  const initialState = context && generation ? readDirectSessionNotificationState(context.linkedMetadata, identity, generation) : null;
  const settingsScope = context ? resolveAccountSettingsScopeKey(context.credentials) : null;
  const acquiredLease = await params.acquireProviderFollowLease(initialState?.cursor);
  if (!acquiredLease) return null;
  if (!acquiredLease.subscribeToTranscriptUpdates) return acquiredLease;
  let released = false;
  let pending = Promise.resolve();
  let observation: DirectSessionObservationV1 = { v: 1, state: 'unknown', reason: 'not_observed' };
  let delivery: 'submitted' | 'not_submitted' | 'unknown' | undefined;

  /** 每次副作用都验证当前关联与关注代次，禁止旧异步任务跨账号、删除或改源生效。 */
  const matches = (metadata: Record<string, unknown>): boolean => Boolean(context && identityParams && generation
    && !released && params.shouldProcessBackgroundFollowEffects()
    && directSessionFollowGeneration(metadata) === generation
    && directSessionNotificationIdentity({ ...identityParams, metadata }) === identity);
  const loadCurrent = async () => {
    if (!context || !matches(context.linkedMetadata)) return null;
    const activeScope = getActiveAccountSettingsSnapshot()?.scopeKey;
    if (activeScope && activeScope !== settingsScope) return null;
    const rawSession = await fetchSessionById({ token: context.credentials.token, sessionId: params.sessionId });
    if (!rawSession) return null;
    const metadata = tryDecryptSessionMetadata({ credentials: context.credentials, rawSession });
    return metadata && matches(metadata) ? { rawSession, metadata } : null;
  };

  /** 对同一 lease 串行消费；跨 lease 的竞争由服务端版本 CAS 裁决。 */
  const processUpdate = async (update: DirectSessionTranscriptUpdate): Promise<void> => {
    if (released) return;
    if (params.emitDirectSessionTranscriptUpdate) {
      try {
        const payload: DirectSessionTranscriptDeltaEphemeral = {
          type: 'direct-session-transcript-delta',
          sessionId: params.sessionId,
          items: Array.from(update.items),
          truncated: update.truncated,
          ...(update.truncationReason ? { truncationReason: update.truncationReason } : {}),
        };
        if (update.fromCursor !== undefined) {
          payload.fromCursor = update.fromCursor;
        }
        const canIncludeNextCursor = update.truncated === true
          || (typeof update.fromCursor === 'string' && update.fromCursor.trim().length > 0);
        if (update.nextCursor !== undefined && canIncludeNextCursor) {
          payload.nextCursor = update.nextCursor;
        }
        await params.emitDirectSessionTranscriptUpdate(payload);
      } catch {
        // Live transcript deltas are best-effort and must not stop the follow lease.
      }
    }

    const transcriptObservations = Array.from(update.items).flatMap((item) => {
      const parsed = DirectSessionObservationV1Schema.safeParse(item.raw.directSessionObservationV1);
      return parsed.success ? [parsed.data] : [];
    });
    const observations = update.observations ?? transcriptObservations.map((observation) => ({ observation, continuity: 'event' as const }));
    const terminalTurnIds = new Set(transcriptObservations.flatMap((next) => next.state !== 'unknown' && next.source === 'rollout'
      && ['completed', 'failed', 'cancelled'].includes(next.state) ? [next.turnId] : []));
    for (const next of observations) observation = next.observation;
    if (params.reason !== 'background_follow' || !context || !generation || !params.shouldProcessBackgroundFollowEffects()) return;
    // 已提交的读取边界也是旧 lease 的围栏，压缩后不能让落后批次倒退游标并重新 claim。
    const matchesReadCursor = (metadata: Record<string, unknown>): boolean => {
      if (!matches(metadata)) return false;
      const cursor = readDirectSessionNotificationState(metadata, identity, generation).cursor;
      return typeof update.fromCursor !== 'string' || !cursor || cursor === update.fromCursor;
    };
    if (resolveDirectTranscriptContinuation(update) === 'source_discontinuity') {
      observation = { v: 1, state: 'unknown', reason: 'source_unavailable' };
      // 不将重定位后的历史片段补成完成；下一份明确快照会重新建立基线。
      const current = await loadCurrent();
      if (current) await updateSessionMetadataWithRetry({ token: context.credentials.token, credentials: context.credentials,
        sessionId: params.sessionId, rawSession: current.rawSession, updater: (metadata) => matchesReadCursor(metadata)
          ? { ...metadata, directSessionV1: { ...directMetadataRecord(metadata.directSessionV1), notificationStateV1: {
            v: 1, identity, generation, claims: readDirectSessionNotificationState(metadata, identity, generation).claims,
            ...(typeof update.nextCursor === 'string' ? { cursor: update.nextCursor } : {}),
          } } } : metadata });
      return;
    }
    for (const next of observations) {
      const current = await loadCurrent();
      if (!current) return;
      if (!matchesReadCursor(current.metadata)) {
        observation = readDirectSessionNotificationState(current.metadata, identity, generation).observation
          ?? { v: 1, state: 'unknown', reason: 'not_observed' };
        return;
      }
      const claimId = randomUUID();
      const reduce = (metadata: Record<string, unknown>) => reduceDirectSessionNotificationObservation({
        current: readDirectSessionNotificationState(metadata, identity, generation), observation: next.observation, continuity: next.continuity,
        sessionId: params.sessionId, machineId: context.machineId, accountId: context.accountId, claimId,
      });
      const candidates = new Map<string, ReturnType<typeof reduce>['events'][number]>();
      const committed = await updateSessionMetadataWithRetry({ token: context.credentials.token, credentials: context.credentials,
        sessionId: params.sessionId, rawSession: current.rawSession,
        updater: (metadata) => {
          if (!matchesReadCursor(metadata)) return metadata;
          const reduced = reduce(metadata);
          // 重算可新增候选；ACK 丢失后重算为空也不能丢本尝试已经提交的自有候选。
          for (const candidate of reduced.events) candidates.set(candidate.key, candidate);
          return { ...metadata, directSessionV1: {
            ...directMetadataRecord(metadata.directSessionV1), notificationStateV1: reduced.state,
          } };
        } });
      const saved = readDirectSessionNotificationState(committed.metadata, identity, generation);
      if (saved.observation) observation = saved.observation;
      for (const candidate of candidates.values()) {
        if (!matches(committed.metadata) || saved.claims[candidate.key]?.id !== claimId) continue;
        // claim 落盘后再次读取撤销/删除事实；释放的 lease 绝不开始新的提交。
        const currentAtSend = await loadCurrent();
        if (!currentAtSend || released || !matchesReadCursor(currentAtSend.metadata)) return;
        const snapshot = getActiveAccountSettingsSnapshot();
        let reason: string | undefined;
        if (!snapshot || snapshot.source === 'none' || snapshot.scopeKey !== settingsScope) {
          delivery = 'not_submitted'; reason = 'settings_unavailable';
        } else {
          const summary = directMetadataRecord(committed.metadata.summary);
          const result = await dispatchActivityNotificationAsync({ settings: snapshot.settings, settingsSecretsReadKeys: snapshot.settingsSecretsReadKeys,
            expoPushSender: context.expoPushSender, event: { ...candidate.event,
              sessionTitle: typeof summary?.text === 'string' ? summary.text : null } });
          delivery = result.unknownChannels ? 'unknown' : result.deliveredChannels > 0 ? 'submitted' : 'not_submitted';
          reason = result.deliveryReason ?? (delivery === 'not_submitted' ? 'disabled' : undefined);
        }
        const latest = await loadCurrent();
        if (!latest) return;
        await updateSessionMetadataWithRetry({ token: context.credentials.token, credentials: context.credentials,
          sessionId: params.sessionId, rawSession: latest.rawSession, updater: (metadata) => {
            if (!matches(metadata)) return metadata;
            const state = readDirectSessionNotificationState(metadata, identity, generation);
            if (state.claims[candidate.key]?.id !== claimId) return metadata;
            return { ...metadata, directSessionV1: { ...directMetadataRecord(metadata.directSessionV1), notificationStateV1: {
              ...state, claims: { ...state.claims, [candidate.key]: { ...state.claims[candidate.key], id: claimId, status: delivery, reason } },
            } } };
          } });
      }
    }
    // 游标只有在本批事实及 claim 已处理之后前移，重启不会越过未处理的完成记录。
    const current = await loadCurrent();
    if (!current) return;
    const progress = deriveDirectSessionObservedProgress(Array.from(update.items));
    await updateSessionMetadataWithRetry({ token: context.credentials.token, credentials: context.credentials,
      sessionId: params.sessionId, rawSession: current.rawSession, updater: (metadata) => {
        if (!matchesReadCursor(metadata)) return metadata;
        const updated = updateMetadataWithDirectSessionObservedProgress(metadata as Metadata, { observedProgress: progress, lastKnownActivityAtMs: progress?.atMs });
        const state = readDirectSessionNotificationState(updated, identity, generation);
        return { ...updated, directSessionV1: { ...directMetadataRecord(updated.directSessionV1), notificationStateV1:
          typeof update.nextCursor === 'string' ? checkpointDirectSessionNotificationState(state, update.nextCursor, terminalTurnIds) : state,
        } };
      } });
  };
  const unsubscribe = acquiredLease.subscribeToTranscriptUpdates((update) => {
    // 一次性 Iterable 先实化，避免转发消耗后事实/进度读取为空。
    const materialized = { ...update, items: Array.from(update.items) };
    const processing = pending.then(() => processUpdate(materialized));
    // 内部队列消化异常以保持可释放，但当前批次的失败必须交回原 poller，不能假确认并越过游标。
    pending = processing.catch(() => { delivery = 'unknown'; });
    return processing;
  });
  return {
    release: async () => {
      if (released) return;
      released = true;
      unsubscribe();
      await Promise.resolve(acquiredLease.release()).catch(() => undefined);
      await pending;
    },
    getTailCursor: acquiredLease.getTailCursor,
    // 状态直接读取持续来源；通知 CAS 队列中的旧检查点不能覆盖当前断连或新轮事实。
    getObservation: () => released ? { v: 1, state: 'unknown', reason: 'connection_closed' }
      : acquiredLease.getObservation?.() ?? observation,
    getNotificationDelivery: () => delivery,
    subscribeToTranscriptUpdates: acquiredLease.subscribeToTranscriptUpdates,
  };
}
