import { DirectSessionObservationV1Schema, resolveDirectTranscriptContinuation, type DirectSessionObservationV1, type DirectSessionsSource } from '@happier-dev/protocol';
import { createPollingDirectSessionFollowLease } from '@/api/directSessions/backgroundFollow/createPollingDirectSessionFollowLease';
import type { DirectSessionFollowLease, DirectSessionObservationFact } from '@/api/directSessions/backgroundFollow/createManagedDirectSessionFollowLease';
import { configuration } from '@/configuration';
import { readAfterCodexTranscript } from './readAfterCodexTranscript';
import { resolveCodexHomeEntriesForDirectSessionsSource } from './resolveCodexHomeEntriesForDirectSessionsSource';
import { DesktopIpc } from './desktop/desktopIpc';
import { readDesktopConversationObservation } from './desktop/desktopConversationObservation';
import { readDesktopControlSnapshot } from './desktop/desktopControlSnapshot';

/** 在既有轮询 lease 中选择只读事实；Desktop 未提供可采用状态时接收连续前向 rollout 事件。 */
export async function createCodexDirectSessionFollowLease(params: {
  source: DirectSessionsSource; remoteSessionId: string; initialCursor?: string;
}): Promise<DirectSessionFollowLease> {
  const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source: params.source, activeServerDir: configuration.activeServerDir, env: process.env });
  let ipc: DesktopIpc | null = null;
  let released = false;
  let baselineStarted = false;
  let baselineSelected = false;
  let baselineInvalidated = false;
  let observation: DirectSessionObservationV1 = { v: 1, state: 'unknown', reason: 'not_observed' };
  let desktopObservation: DirectSessionObservationV1 = observation;
  const pending: DirectSessionObservationFact[] = [];
  /** 终态只属于已证明的同一轮，后来的重复运行事实不能将它重新激活。 */
  const isTerminal = (value: DirectSessionObservationV1): boolean =>
    value.state === 'completed' || value.state === 'failed' || value.state === 'cancelled';
  /** 统一更新 getter 与待消费队列，避免展示和通知链选择不同来源。 */
  const publish = (next: DirectSessionObservationV1, continuity: DirectSessionObservationFact['continuity']) => {
    baselineSelected = false;
    observation = next;
    pending.push({ observation: next, continuity });
  };
  /** 只有已采用的 Desktop 明确事实占据展示来源，socket 存在和被拒绝的晚到事实都不算。 */
  const hasUsableDesktopObservation = (): boolean => !baselineSelected && desktopObservation.state !== 'unknown'
    && observation.state !== 'unknown' && observation.source === 'desktop';
  /** 来源失效时同步撤销已知事实，并沿既有轮询链通知消费者。 */
  const markSourceUnavailable = () => {
    // 即使已经处于同一个 unknown 对象，等待中的基线也必须记住来源曾经失效。
    if (baselineStarted) baselineInvalidated = true;
    if (!released && (observation.state !== 'unknown' || observation.reason !== 'source_unavailable')) {
      publish({ v: 1, state: 'unknown', reason: 'source_unavailable' }, 'snapshot');
    }
  };
  /** Desktop 未知不否定有效 rollout；跨来源换轮没有顺序证明，同轮更完整的 Desktop 状态才可接替。 */
  const observeDesktop = (next: DirectSessionObservationV1, continuity: DirectSessionObservationFact['continuity']) => {
    if (released) return;
    desktopObservation = next;
    if (baselineSelected && observation.state !== 'unknown') {
      // 新长订阅首包尚未确认不是失联；它也不能给独立已关联基线增加永久优先级。
      if (next.state === 'unknown' && next.reason === 'not_observed') return;
      if (next.state !== 'unknown') {
        if (next.turnId === observation.turnId && next.state === observation.state) return;
        // 不同轮只能由 canonical 当前尾岛证明基线在前，不能把别的 scope 自身 confirmed 当证明。
        if (next.turnId !== observation.turnId
            && !ipc?.confirmsFollowingTurn(params.remoteSessionId, observation.turnId, next)) return;
      }
    }
    if (observation.state !== 'unknown' && observation.source === 'rollout') {
      if (next.state === 'unknown' || next.turnId !== observation.turnId
          || isTerminal(observation) || next.state === observation.state) return;
    }
    if (observation.state !== 'unknown' && next.state !== 'unknown'
        && next.turnId === observation.turnId && isTerminal(observation)) return;
    publish(next, continuity);
  };
  /** 仅建立既有长订阅，重连和外部快照都不能再次触发历史水合请求。 */
  const follow = (opened: DesktopIpc) => {
    opened.followConversation(params.remoteSessionId, (next, continuity) => {
      if (released || ipc !== opened) return;
      observeDesktop(next, continuity);
      if (opened.isClosed()) ipc = null;
    });
  };
  /** 每份租约只读取一次关联当前快照；先有文件边界，等待期间的新事实优先于迟到基线。 */
  const initializeBaseline = async (opened: DesktopIpc) => {
    baselineStarted = true;
    const before = observation;
    try {
      const raw = await opened.readControlSnapshot(params.remoteSessionId);
      // 复用控制 owner 的 runtime/当前尾轮校验，再用唯一观察投影器生成状态。
      readDesktopControlSnapshot(raw, params.remoteSessionId);
      const next = readDesktopConversationObservation(raw, params.remoteSessionId);
      if (!released && ipc === opened && !baselineInvalidated && before.state === 'unknown' && observation === before && next.state !== 'unknown') {
        publish(next, 'snapshot');
        baselineSelected = true;
      }
    } catch {
      // 基线不可证时保持现有未知或前向事实，不能把历史首包降级为当前状态。
    }
    if (released || ipc !== opened) return;
    try {
      follow(opened);
    } catch {
      opened.close(); ipc = null;
      if (observation.state === 'unknown' || observation.source !== 'rollout') markSourceUnavailable();
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
      // 初次连接先由下方文件读取建立边界，再异步读取一次基线；后续连接直接订阅。
      if (baselineStarted) follow(opened);
    } catch {
      opened?.close(); ipc = null;
      if (observation.state === 'unknown' || observation.source !== 'rollout') markSourceUnavailable();
    }
  };
  const polling = await createPollingDirectSessionFollowLease({
    initialCursor: params.initialCursor,
    /** 先读取来源连续性，再消费前向事实；来源失效会撤销 rollout，而不是依赖 IPC 是否连接。 */
    readAfterTranscript: async ({ cursor, maxBytes, maxItems }) => {
      await connect();
      const result = await readAfterCodexTranscript({ ...params, activeServerDir: configuration.activeServerDir, cursor, maxBytes, maxItems }).catch((error) => {
        // 文件读取失败只撤销依赖 rollout 的状态，已确认的 Desktop 来源仍独立有效。
        if (!hasUsableDesktopObservation()) markSourceUnavailable();
        throw error;
      });
      const rolloutUnavailable = result.historyAvailability !== 'available'
        || resolveDirectTranscriptContinuation(result) === 'source_discontinuity';
      if (!hasUsableDesktopObservation() && rolloutUnavailable) markSourceUnavailable();
      // 断点变化批次不能作为新轮事件；只有同一来源的前向显式记录能恢复已知状态。
      if (!released && !hasUsableDesktopObservation() && !rolloutUnavailable) for (const item of result.items) {
        const fact = DirectSessionObservationV1Schema.safeParse(item.raw.directSessionObservationV1);
        if (!fact.success) continue;
        if (observation.state !== 'unknown' && fact.data.state !== 'unknown'
            && observation.turnId === fact.data.turnId && isTerminal(observation)) continue;
        publish(fact.data, 'event');
      }
      // 不 await 水合请求，原轮询继续接收等待期间的新轮和来源失效事实。
      if (!released && ipc && !baselineStarted && !rolloutUnavailable) void initializeBaseline(ipc);
      return { ...result, observations: pending.splice(0) };
    },
  });
  return { ...polling,
    /** 只返回当前已选择来源的事实，释放后的旧引用一律未知。 */
    getObservation: () => released ? { v: 1, state: 'unknown', reason: 'connection_closed' } : observation,
    /** 先撤销观察，再等待轮询释放，迟到回调不能恢复已释放的 lease。 */
    release: async () => {
      released = true; observation = { v: 1, state: 'unknown', reason: 'connection_closed' };
      pending.length = 0; ipc?.close(); ipc = null; await polling.release();
    } };
}
