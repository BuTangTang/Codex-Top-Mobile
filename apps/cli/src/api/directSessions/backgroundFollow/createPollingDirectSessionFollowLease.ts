import type { DirectTranscriptRawMessageV1, DirectTranscriptTruncationReason } from '@happier-dev/protocol';
import { resolveDirectTranscriptContinuation } from '@happier-dev/protocol';
import { logger } from '@/ui/logger';

import type {
  DirectSessionFollowLease,
  DirectSessionTranscriptUpdate,
  DirectSessionTranscriptUpdateListener,
  DirectSessionObservationFact,
} from './createManagedDirectSessionFollowLease';

type DirectSessionTranscriptReadAfter = Readonly<{
  items: readonly DirectTranscriptRawMessageV1[];
  nextCursor?: string | null;
  truncated: boolean;
  truncationReason?: DirectTranscriptTruncationReason;
  observations?: readonly DirectSessionObservationFact[];
}>;

type DirectSessionPollingFollowLeaseParams = Readonly<{
  readAfterTranscript: (params: Readonly<{
    cursor: string;
    maxBytes: number;
    maxItems: number;
  }>) => Promise<DirectSessionTranscriptReadAfter>;
  env?: NodeJS.ProcessEnv;
  initialCursor?: string;
}>;

function resolvePollIntervalMs(env: NodeJS.ProcessEnv): number {
  const raw = Number.parseInt(String(env.HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 250;
  return Math.max(10, Math.min(60_000, configured));
}

function resolveMaxBytes(env: NodeJS.ProcessEnv): number {
  const raw = Number.parseInt(String(env.HAPPIER_DIRECT_SESSIONS_FOLLOW_MAX_BYTES ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 512_000;
  return Math.max(1024, Math.min(10 * 1024 * 1024, configured));
}

function resolveMaxItems(env: NodeJS.ProcessEnv): number {
  const raw = Number.parseInt(String(env.HAPPIER_DIRECT_SESSIONS_FOLLOW_MAX_ITEMS ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 200;
  return Math.max(1, Math.min(5000, configured));
}

async function notifyTranscriptListeners(
  listeners: ReadonlySet<DirectSessionTranscriptUpdateListener>,
  update: DirectSessionTranscriptUpdate,
): Promise<void> {
  const results = await Promise.allSettled(Array.from(listeners, async (listener) => {
    await listener(update);
  }));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

export async function createPollingDirectSessionFollowLease(
  params: DirectSessionPollingFollowLeaseParams,
): Promise<DirectSessionFollowLease> {
  const env = params.env ?? process.env;
  const pollIntervalMs = resolvePollIntervalMs(env);
  const maxBytes = resolveMaxBytes(env);
  const maxItems = resolveMaxItems(env);
  const listeners = new Set<DirectSessionTranscriptUpdateListener>();

  let readFailureReported = false;
  const reportReadFailure = (error: unknown): void => {
    if (!readFailureReported) {
      logger.infoFile('[directSessions] Transcript read or checkpoint failed; background follow will retry', error);
      readFailureReported = true;
    }
  };

  const initial = params.initialCursor ? null : await params.readAfterTranscript({
    cursor: 'tail',
    maxBytes,
    maxItems,
  }).catch((error) => {
    reportReadFailure(error);
    return null;
  });
  // 初始快照也等待同一确认链；整份待提交批次只保留一份，不再次消费提供方的 Desktop 队列。
  let pendingBatch: DirectSessionTranscriptUpdate | null = initial?.observations?.length
    ? { items: [], observations: initial.observations, nextCursor: initial.nextCursor ?? null, truncated: false }
    : null;
  let tailCursor = params.initialCursor ?? (pendingBatch ? null : initial?.nextCursor ?? null);
  let released = false;
  let polling = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPollTimer = (): void => {
    if (!pollTimer) return;
    clearTimeout(pollTimer);
    pollTimer = null;
  };

  const schedulePoll = (): void => {
    if (released || listeners.size === 0 || pollTimer) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void pollOnce();
    }, pollIntervalMs);
  };

  const pollOnce = async (): Promise<void> => {
    if (released || polling || listeners.size === 0) return;
    polling = true;
    try {
      if (!pendingBatch) {
        const fromCursor = tailCursor ?? 'tail';
        const result = await params.readAfterTranscript({ cursor: fromCursor, maxBytes, maxItems });
        if (released) return;
        const items = Array.from(result.items);
        const cursorAdvanced = typeof result.nextCursor === 'string' && result.nextCursor !== fromCursor;
        if (items.length > 0 || result.observations?.length || cursorAdvanced || resolveDirectTranscriptContinuation(result) !== 'complete') {
          pendingBatch = {
            items, fromCursor, nextCursor: result.nextCursor ?? null, truncated: result.truncated === true,
            ...(result.truncationReason ? { truncationReason: result.truncationReason } : {}),
            ...(result.observations ? { observations: result.observations } : {}),
          };
        }
      }
      if (pendingBatch) {
        if (listeners.size === 0) return;
        const batch = pendingBatch;
        await notifyTranscriptListeners(listeners, batch);
        if (released) return;
        // 只有消费方确认（包括持久化 cursor CAS）成功，才释放批次并推进内存读取位置。
        if (typeof batch.nextCursor === 'string') tailCursor = batch.nextCursor;
        pendingBatch = null;
      }
      readFailureReported = false;
    } catch (error) {
      // 原轮询 tick 重试原批次；明确撤销由消费方正常返回，不能当作异常反复处理。
      if (!released) reportReadFailure(error);
    } finally {
      polling = false;
      schedulePoll();
    }
  };

  return {
    release: () => {
      released = true;
      clearPollTimer();
      listeners.clear();
      pendingBatch = null;
    },
    getTailCursor: () => tailCursor,
    subscribeToTranscriptUpdates: (listener) => {
      if (released) return () => {};
      listeners.add(listener);
      void pollOnce();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearPollTimer();
        }
      };
    },
  };
}
