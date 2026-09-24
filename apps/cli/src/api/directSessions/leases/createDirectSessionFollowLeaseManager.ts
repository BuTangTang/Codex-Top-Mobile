import { createDirectSessionViewerLeaseRegistry } from './directSessionViewerLeaseRegistry';
import type { DirectSessionObservationV1 } from '@happier-dev/protocol';
import type { DirectSessionFollowLease as ObservableFollowLease } from '../backgroundFollow/createManagedDirectSessionFollowLease';

export type DirectSessionFollowLease = ObservableFollowLease;

type ManagedFollowLeaseRecord = {
  sessionId: string;
  release: (() => void | Promise<void>) | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  lease?: DirectSessionFollowLease;
  targetKey?: string;
  expiresAtMs?: number;
  notificationGeneration?: string;
};

type DirectSessionFollowLeaseManagerParams = Readonly<{
  now?: () => number;
  randomId?: () => string;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}>;

type FollowLeaseAcquirer = () => Promise<DirectSessionFollowLease | null>;

function clearManagedTimer(
  timer: ReturnType<typeof setTimeout> | null,
  clearTimer: typeof clearTimeout,
): void {
  if (timer) {
    clearTimer(timer);
  }
}

export function createDirectSessionFollowLeaseManager(params?: DirectSessionFollowLeaseManagerParams) {
  const now = params?.now ?? Date.now;
  const setTimer = params?.setTimer ?? setTimeout;
  const clearTimer = params?.clearTimer ?? clearTimeout;
  const viewerLeaseRegistry = createDirectSessionViewerLeaseRegistry({
    now,
    randomId: params?.randomId,
  });
  const followLeasesById = new Map<string, ManagedFollowLeaseRecord>();
  const backgroundFollowEnabledBySessionId = new Map<string, boolean>();
  const backgroundFollowAcquireBySessionId = new Map<string, { acquire: FollowLeaseAcquirer; targetKey?: string; notificationGeneration?: string }>();
  const backgroundFollowLeasesBySessionId = new Map<string, ManagedFollowLeaseRecord>();
  const backgroundAcquisitionsBySessionId = new Map<string, Promise<boolean>>();
  let disposed = false;

  /** 先移除 viewer 引用，再等待外部资源释放，撤销立即对状态查询生效。 */
  const releaseFollowLease = async (leaseId: string, sessionId: string): Promise<boolean> => {
    const record = followLeasesById.get(leaseId) ?? null;
    if (!record || record.sessionId !== sessionId) return false;
    followLeasesById.delete(leaseId);
    clearManagedTimer(record.expiryTimer, clearTimer);
    await record.release?.();
    return true;
  };

  /** 后台观察同样先撤销所有权，释放中的旧状态不能继续供查询读取。 */
  const releaseBackgroundFollowLease = async (sessionId: string): Promise<boolean> => {
    const record = backgroundFollowLeasesBySessionId.get(sessionId) ?? null;
    if (!record) return false;
    backgroundFollowLeasesBySessionId.delete(sessionId);
    clearManagedTimer(record.expiryTimer, clearTimer);
    await record.release?.();
    return true;
  };

  /** 每会话只保留一次后台获取；完成时必须仍属于当前 token 和关注代次。 */
  const acquireDetachedBackgroundFollowLease = async (
    sessionId: string,
    acquireFollowLease: FollowLeaseAcquirer | null | undefined,
    targetKey?: string,
    notificationGeneration?: string,
  ): Promise<boolean> => {
    if (backgroundFollowLeasesBySessionId.has(sessionId)) {
      return false;
    }
    if (!acquireFollowLease) {
      return false;
    }
    const pending = backgroundAcquisitionsBySessionId.get(sessionId);
    if (pending) {
      await pending;
      return false;
    }
    // 查看租约到期和恢复关注共用同一获取过程；旧代次结束后不能覆盖新 owner。
    const acquisition = Promise.resolve().then(async () => {
      const followLease = await acquireFollowLease();
      if (!followLease) return false;
      if (disposed || !backgroundFollowEnabledBySessionId.get(sessionId)
        || backgroundAcquisitionsBySessionId.get(sessionId) !== acquisition) {
        await followLease.release();
        return false;
      }
      backgroundFollowLeasesBySessionId.set(sessionId, {
        sessionId, release: followLease.release, expiryTimer: null, lease: followLease, targetKey, notificationGeneration,
      });
      // 已有查看者转用同一后台 lease，观看不会禁止向其他设备发通知。
      for (const record of followLeasesById.values()) if (record.sessionId === sessionId && record.release) {
        const release = record.release;
        record.release = null;
        record.lease = undefined;
        await release();
      }
      return true;
    });
    backgroundAcquisitionsBySessionId.set(sessionId, acquisition);
    try { return await acquisition; }
    finally {
      if (backgroundAcquisitionsBySessionId.get(sessionId) === acquisition) backgroundAcquisitionsBySessionId.delete(sessionId);
    }
  };

  /** 最后一个 viewer 离开后，仅显式后台关注可以继续保留观察连接。 */
  const handleNoActiveViewerLeases = async (sessionId: string): Promise<void> => {
    if (viewerLeaseRegistry.countActiveLeases(sessionId) > 0) {
      return;
    }
    if (backgroundFollowEnabledBySessionId.get(sessionId) === true) {
      const acquisition = backgroundFollowAcquireBySessionId.get(sessionId);
      if (acquisition) {
        await acquireDetachedBackgroundFollowLease(sessionId, acquisition.acquire, acquisition.targetKey, acquisition.notificationGeneration).catch(() => false);
      }
      return;
    }
    await releaseBackgroundFollowLease(sessionId);
  };

  /** 按当前记录的到期时间清理；异步获取返回时不能覆盖期间已接受的续租。 */
  const scheduleExpiry = (leaseId: string, sessionId: string, expiresAtMs: number): void => {
    const record = followLeasesById.get(leaseId);
    if (!record || record.sessionId !== sessionId) return;
    clearManagedTimer(record.expiryTimer, clearTimer);
    const delayMs = Math.max(0, expiresAtMs - now());
    record.expiryTimer = setTimer(() => {
      void (async () => {
        viewerLeaseRegistry.detach({ sessionId, leaseId });
        await releaseFollowLease(leaseId, sessionId).catch(() => false);
        await handleNoActiveViewerLeases(sessionId);
      })();
    }, delayMs);
  };

  /** 先同步移除所有记录，再等底层释放，防止旧异步获取和状态读取复活已撤销目标。 */
  const invalidateSession = async (sessionId: string): Promise<void> => {
    backgroundFollowEnabledBySessionId.delete(sessionId);
    backgroundFollowAcquireBySessionId.delete(sessionId);
    backgroundAcquisitionsBySessionId.delete(sessionId);
    const releases = [releaseBackgroundFollowLease(sessionId)];
    for (const [leaseId, record] of followLeasesById) if (record.sessionId === sessionId) {
      viewerLeaseRegistry.detach({ sessionId, leaseId });
      releases.push(releaseFollowLease(leaseId, sessionId));
    }
    await Promise.all(releases);
  };

  return {
    /** 注册查看者；相同 ID 续租不重复获取，迟到结果必须仍归属于原 record。 */
    async attach(input: Readonly<{
      sessionId: string;
      leaseId?: string | null;
      ttlMs: number;
      targetKey?: string;
      acquireFollowLease?: FollowLeaseAcquirer;
    }>) {
      if (disposed) throw new Error('follow_manager_disposed');
      const requested = input.leaseId ? followLeasesById.get(input.leaseId.trim()) : undefined;
      if (requested && (requested.sessionId !== input.sessionId || requested.targetKey !== input.targetKey)) {
        throw new Error('follow_target_changed');
      }
      const attached = viewerLeaseRegistry.attach({
        sessionId: input.sessionId,
        leaseId: input.leaseId,
        ttlMs: input.ttlMs,
      });

      const existing = followLeasesById.get(attached.leaseId) ?? null;
      if (!attached.renewed || !existing) {
        const record: ManagedFollowLeaseRecord = {
          sessionId: input.sessionId, release: null, expiryTimer: null,
          targetKey: input.targetKey, expiresAtMs: attached.expiresAtMs,
        };
        // 获取前先登记同一 record；续租、撤销与迟到结果都以它的身份裁决。
        followLeasesById.set(attached.leaseId, record);
        scheduleExpiry(attached.leaseId, input.sessionId, attached.expiresAtMs);
        try {
          clearManagedTimer(existing?.expiryTimer ?? null, clearTimer);
          if (existing?.release) await existing.release();
          const background = backgroundFollowLeasesBySessionId.get(input.sessionId);
          const followLease = background && background.targetKey === input.targetKey
            ? null
            : (await input.acquireFollowLease?.()) ?? null;
          if (disposed || followLeasesById.get(attached.leaseId) !== record || (record.expiresAtMs ?? 0) <= now()) {
            await followLease?.release();
          } else if (backgroundFollowLeasesBySessionId.get(input.sessionId)?.targetKey === input.targetKey
              && backgroundFollowLeasesBySessionId.has(input.sessionId)) {
            await followLease?.release();
          } else {
            record.release = followLease?.release ?? null;
            record.lease = followLease ?? undefined;
          }
        } catch (error) {
          if (followLeasesById.get(attached.leaseId) === record) {
            viewerLeaseRegistry.detach({ sessionId: input.sessionId, leaseId: attached.leaseId });
            await releaseFollowLease(attached.leaseId, input.sessionId);
          }
          throw error;
        }
      } else existing.expiresAtMs = attached.expiresAtMs;

      const current = followLeasesById.get(attached.leaseId);
      if (current) scheduleExpiry(attached.leaseId, input.sessionId, current.expiresAtMs ?? attached.expiresAtMs);
      return attached;
    },

    /** 移除指定查看者，后台关注或其他查看者仍由既有生命周期决定是否保留。 */
    async detach(input: Readonly<{ sessionId: string; leaseId: string }>) {
      const detached = viewerLeaseRegistry.detach(input);
      if (detached.detached) {
        await releaseFollowLease(input.leaseId, input.sessionId).catch(() => false);
        await handleNoActiveViewerLeases(input.sessionId);
      }
      return detached;
    },

    /** 停止通知可保留查看连接；重新开启的新代次必须重建通知上下文。 */
    async setBackgroundFollowEnabled(input: Readonly<{
      sessionId: string;
      enabled: boolean;
      targetKey?: string;
      notificationGeneration?: string;
      acquireFollowLease?: FollowLeaseAcquirer;
    }>) {
      if (disposed) return { enabled: false, leaseAcquired: false } as const;
      backgroundFollowEnabledBySessionId.set(input.sessionId, input.enabled);

      if (!input.enabled) {
        backgroundFollowAcquireBySessionId.delete(input.sessionId);
        backgroundAcquisitionsBySessionId.delete(input.sessionId);
        if (viewerLeaseRegistry.countActiveLeases(input.sessionId) === 0) {
          await releaseBackgroundFollowLease(input.sessionId).catch(() => false);
        }
        return { enabled: false, leaseAcquired: false } as const;
      }

      if (input.acquireFollowLease) {
        const previous = backgroundFollowAcquireBySessionId.get(input.sessionId);
        const config = { acquire: input.acquireFollowLease, targetKey: input.targetKey, notificationGeneration: input.notificationGeneration };
        backgroundFollowAcquireBySessionId.set(input.sessionId, config);
        const current = backgroundFollowLeasesBySessionId.get(input.sessionId);
        if ((current && current.notificationGeneration !== input.notificationGeneration)
            || (previous && previous.notificationGeneration !== input.notificationGeneration)) {
          backgroundAcquisitionsBySessionId.delete(input.sessionId);
          await releaseBackgroundFollowLease(input.sessionId);
          if (disposed || !backgroundFollowEnabledBySessionId.get(input.sessionId)
              || backgroundFollowAcquireBySessionId.get(input.sessionId) !== config) return { enabled: false, leaseAcquired: false } as const;
        }
      }

      const acquireFollowLease =
        input.acquireFollowLease ?? backgroundFollowAcquireBySessionId.get(input.sessionId)?.acquire ?? null;
      const leaseAcquired = await acquireDetachedBackgroundFollowLease(input.sessionId, acquireFollowLease, input.targetKey, input.notificationGeneration);
      return { enabled: !disposed && backgroundFollowEnabledBySessionId.get(input.sessionId) === true, leaseAcquired } as const;
    },

    countActiveLeases(sessionId: string): number {
      return viewerLeaseRegistry.countActiveLeases(sessionId);
    },

    isBackgroundFollowEnabled(sessionId: string): boolean {
      return backgroundFollowEnabledBySessionId.get(sessionId) ?? false;
    },

    hasBackgroundFollowLease(sessionId: string): boolean {
      return backgroundFollowLeasesBySessionId.has(sessionId);
    },
    /** 通知交付结果只从当前后台 lease 获取。 */
    getBackgroundFollowLease(sessionId: string): DirectSessionFollowLease | undefined {
      return backgroundFollowLeasesBySessionId.get(sessionId)?.lease;
    },
    /** 同一认证目标只读当前有效 lease；不合并多个来源，也不回退到过期的已知状态。 */
    getObservation(input: Readonly<{ sessionId: string; targetKey?: string }>): DirectSessionObservationV1 {
      const unknown: DirectSessionObservationV1 = { v: 1, state: 'unknown', reason: 'not_observed' };
      if (disposed) return unknown;
      const background = backgroundFollowLeasesBySessionId.get(input.sessionId);
      if (background && background.targetKey === input.targetKey
          && (backgroundFollowEnabledBySessionId.get(input.sessionId) || viewerLeaseRegistry.countActiveLeases(input.sessionId) > 0)) {
        return background.lease?.getObservation?.() ?? unknown;
      }
      for (const record of followLeasesById.values()) {
        if (record.sessionId === input.sessionId && record.targetKey === input.targetKey
            && (record.expiresAtMs ?? 0) > now() && record.lease) return record.lease.getObservation?.() ?? unknown;
      }
      return unknown;
    },
    invalidateSession,
    /** 已核验的关联身份改变时，撤销旧来源及其正在获取的连接，不创建替代连接。 */
    async invalidateMismatchedTarget(input: Readonly<{ sessionId: string; targetKey: string }>): Promise<void> {
      const records = [...followLeasesById.values(), ...backgroundFollowLeasesBySessionId.values()];
      const config = backgroundFollowAcquireBySessionId.get(input.sessionId);
      if (records.some((record) => record.sessionId === input.sessionId && record.targetKey !== input.targetKey)
          || (config && config.targetKey !== input.targetKey)) await invalidateSession(input.sessionId);
    },
    /** 切账号或服务器时同步撤销全部 viewer 和后台连接，manager 本身仍可复用。 */
    async invalidateAll(): Promise<void> {
      const sessions = new Set([...backgroundFollowAcquireBySessionId.keys(), ...backgroundFollowLeasesBySessionId.keys(),
        ...Array.from(followLeasesById.values(), (record) => record.sessionId)]);
      await Promise.all(Array.from(sessions, invalidateSession));
    },
    /** 退出后拒绝新获取，先撤销所有引用再等待底层资源结束。 */
    async dispose(): Promise<void> {
      disposed = true;
      backgroundFollowEnabledBySessionId.clear();
      backgroundFollowAcquireBySessionId.clear();
      backgroundAcquisitionsBySessionId.clear();
      const releases = [...backgroundFollowLeasesBySessionId.keys()].map(releaseBackgroundFollowLease);
      for (const [leaseId, record] of followLeasesById) {
        viewerLeaseRegistry.detach({ sessionId: record.sessionId, leaseId });
        releases.push(releaseFollowLease(leaseId, record.sessionId));
      }
      await Promise.all(releases);
    },
  };
}
