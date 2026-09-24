import { DirectSessionObservationV1Schema, resolveDirectTranscriptContinuation, type DirectSessionObservationV1, type DirectSessionsSource } from '@happier-dev/protocol';
import { createPollingDirectSessionFollowLease } from '@/api/directSessions/backgroundFollow/createPollingDirectSessionFollowLease';
import type { DirectSessionFollowLease, DirectSessionObservationFact } from '@/api/directSessions/backgroundFollow/createManagedDirectSessionFollowLease';
import { configuration } from '@/configuration';
import { readAfterCodexTranscript } from './readAfterCodexTranscript';
import { resolveCodexHomeEntriesForDirectSessionsSource } from './resolveCodexHomeEntriesForDirectSessionsSource';
import { DesktopIpc } from './desktop/desktopIpc';

/** 在既有轮询 lease 中组合只读 Desktop 事实；只有 Desktop 不可用时使用显式 rollout 事件。 */
export async function createCodexDirectSessionFollowLease(params: {
  source: DirectSessionsSource; remoteSessionId: string; initialCursor?: string;
}): Promise<DirectSessionFollowLease> {
  const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source: params.source, activeServerDir: configuration.activeServerDir, env: process.env });
  let ipc: DesktopIpc | null = null;
  let released = false;
  let observation: DirectSessionObservationV1 = { v: 1, state: 'unknown', reason: 'not_observed' };
  const pending: DirectSessionObservationFact[] = [];
  /** 来源失效时同步撤销已知事实，并沿既有轮询链通知消费者。 */
  const markSourceUnavailable = () => {
    if (!released && (observation.state !== 'unknown' || observation.reason !== 'source_unavailable')) {
      observation = { v: 1, state: 'unknown', reason: 'source_unavailable' };
      pending.push({ observation, continuity: 'snapshot' });
    }
  };
  /** 重连只恢复 Desktop 订阅；探测失败不撤销仍有效的 rollout 读取来源。 */
  const connect = async () => {
    if (ipc || released || homes.length !== 1) return;
    let opened: DesktopIpc | null = null;
    try {
      opened = await DesktopIpc.open(homes[0]!.codexHome);
      await opened.discoverOwner(params.remoteSessionId);
      if (released) { opened.close(); return; }
      ipc = opened;
      opened.followConversation(params.remoteSessionId, (next, continuity) => {
        if (released) return;
        observation = next;
        pending.push({ observation: next, continuity });
        if (opened?.isClosed()) ipc = null;
      });
    } catch {
      opened?.close(); ipc = null;
      if (observation.state === 'unknown' || observation.source !== 'rollout') markSourceUnavailable();
    }
  };
  const polling = await createPollingDirectSessionFollowLease({
    initialCursor: params.initialCursor,
    readAfterTranscript: async ({ cursor, maxBytes, maxItems }) => {
      await connect();
      const result = await readAfterCodexTranscript({ ...params, activeServerDir: configuration.activeServerDir, cursor, maxBytes, maxItems }).catch((error) => {
        if (!ipc) markSourceUnavailable();
        throw error;
      });
      const rolloutUnavailable = result.historyAvailability !== 'available'
        || resolveDirectTranscriptContinuation(result) === 'source_discontinuity';
      if (!ipc && rolloutUnavailable) markSourceUnavailable();
      const observations = pending.splice(0);
      // 断点变化批次不能作为新轮事件；只有同一来源的前向显式记录能恢复已知状态。
      if (!released && !ipc && !rolloutUnavailable) for (const item of result.items) {
        const fact = DirectSessionObservationV1Schema.safeParse(item.raw.directSessionObservationV1);
        if (fact.success) { observation = fact.data; observations.push({ observation: fact.data, continuity: 'event' }); }
      }
      return { ...result, observations };
    },
  });
  return { ...polling, getObservation: () => released ? { v: 1, state: 'unknown', reason: 'connection_closed' } : observation, release: async () => {
    // 先撤销观察，再等待轮询释放；旧引用在清理期间也不能返回已知状态。
    released = true; observation = { v: 1, state: 'unknown', reason: 'connection_closed' };
    pending.length = 0; ipc?.close(); ipc = null; await polling.release();
  } };
}
