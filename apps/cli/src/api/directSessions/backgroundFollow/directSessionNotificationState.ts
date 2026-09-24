import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DirectSessionObservationV1Schema, readDirectSessionFollowPolicyV1, type DirectSessionObservationV1 } from '@happier-dev/protocol';
import type { ActivityNotificationEvent } from '@/activity/notifications/activityNotificationEvent';
import { resolveServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';

const ClaimSchema = z.object({ id: z.string(), turnId: z.string().optional(), coveredByCursor: z.boolean().optional(),
  status: z.enum(['submitted', 'not_submitted', 'unknown']), reason: z.string().optional() });
const StateSchema = z.object({
  v: z.literal(1), identity: z.string(), generation: z.string(),
  observation: DirectSessionObservationV1Schema.optional(),
  lastKnown: DirectSessionObservationV1Schema.optional(),
  cursor: z.string().optional(),
  claims: z.record(z.string(), ClaimSchema),
});
export type DirectSessionNotificationState = z.infer<typeof StateSchema>;

/** 只处理对象，不接受数组形式的元数据。 */
export function directMetadataRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 对身份字段稳定序列化，不将关注状态、标题和时间进度混入目标身份。 */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = directMetadataRecord(value);
  return object ? `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}` : JSON.stringify(value) ?? 'null';
}
/** 对私有逻辑身份取摘要，不保存正文或路径作为通知去重键。 */
function hash(value: unknown): string { return createHash('sha256').update(stable(value)).digest('hex'); }

/** 绑定当前 server/account/machine/关联/原生来源；摘要只保存在私有会话元数据中。 */
export function directSessionNotificationIdentity(params: { metadata: Record<string, unknown>; accountId: string; machineId: string; sessionId: string }): string {
  const direct = directMetadataRecord(params.metadata.directSessionV1);
  return hash([resolveServerHttpBaseUrl(), params.accountId, params.machineId, params.sessionId,
    direct?.v, direct?.providerId, direct?.machineId, direct?.remoteSessionId, direct?.source, direct?.linkedAtMs, direct?.agentRuntimeDescriptorV1]);
}

/** 旧关注策略也有明确代次；新写入者使用 generation，旧记录以既有更新时间建立基线。 */
export function directSessionFollowGeneration(metadata: Record<string, unknown>): string | null {
  const direct = directMetadataRecord(metadata.directSessionV1);
  const policy = readDirectSessionFollowPolicyV1(direct?.followPolicyV1);
  if (policy?.policy !== 'background_follow') return null;
  const generation = directMetadataRecord(direct?.followPolicyV1)?.generation;
  return typeof generation === 'string' && generation ? generation : `legacy:${policy.updatedAtMs ?? 'unversioned'}`;
}

/** 不使用不匹配来源或旧关注代次的检查点。 */
export function readDirectSessionNotificationState(metadata: Record<string, unknown>, identity: string, generation: string): DirectSessionNotificationState {
  const parsed = StateSchema.safeParse(directMetadataRecord(metadata.directSessionV1)?.notificationStateV1);
  if (!parsed.success || parsed.data.identity !== identity || parsed.data.generation !== generation) return { v: 1, identity, generation, claims: {} };
  const state = parsed.data;
  // 旧格式只保存 lastKnown 这一轮的 claim；在读取边界补齐其所属轮次。
  if (state.lastKnown && state.lastKnown.state !== 'unknown') {
    const turnId = state.lastKnown.turnId;
    state.claims = Object.fromEntries(Object.entries(state.claims).map(([key, claim]) => [key, { ...claim, turnId: claim.turnId ?? turnId }]));
  }
  return state;
}

/** 只认游标内明确读取到的同一 turn 终态；任意 rollout 前进不能证明更早到达的 Desktop 事实已被覆盖。 */
export function checkpointDirectSessionNotificationState(state: DirectSessionNotificationState, nextCursor: string, terminalTurnIds: ReadonlySet<string>): DirectSessionNotificationState {
  if (state.cursor === nextCursor) return state;
  const currentTurnId = state.lastKnown && state.lastKnown.state !== 'unknown' ? state.lastKnown.turnId : null;
  return { ...state, cursor: nextCursor, claims: Object.fromEntries(Object.entries(state.claims)
    .map(([key, claim]) => [key, claim.turnId && terminalTurnIds.has(claim.turnId) ? { ...claim, coveredByCursor: true } : claim] as const)
    .filter(([, claim]) => !claim.coveredByCursor || claim.turnId === currentTurnId)) };
}

/** 单一归约器只消费显式事实；换轮不能清除尚未推进读取边界的 claim。 */
export function reduceDirectSessionNotificationObservation(params: {
  current: DirectSessionNotificationState; observation: DirectSessionObservationV1;
  sessionId: string; machineId: string; accountId?: string; claimId: string;
  continuity: 'snapshot' | 'event';
}): { state: DirectSessionNotificationState; events: Array<{ key: string; event: ActivityNotificationEvent }> } {
  const { current, observation } = params;
  const previous = current.lastKnown;
  if (observation.state === 'unknown') return { state: { ...current, observation }, events: [] };
  const sameTurn = previous?.state !== 'unknown' && previous?.turnId === observation.turnId;
  const previousTerminal = previous && ['completed', 'failed', 'cancelled'].includes(previous.state);
  // 连续来源的重复消息不能把已结束的同一轮重新变成运行，也不能反复产生完成通知。
  if (sameTurn && previousTerminal) return { state: { ...current, observation: previous }, events: [] };
  const state: DirectSessionNotificationState = { ...current, observation, lastKnown: observation,
    claims: { ...current.claims } };
  const events: Array<{ key: string; event: ActivityNotificationEvent }> = [];
  if ((!previous || !sameTurn) && params.continuity === 'snapshot') return { state, events };
  const add = (topic: 'ready' | 'session_failed' | 'permission_request' | 'user_action_request', requestId?: string) => {
    const key = hash([current.identity, observation.turnId, topic, requestId ?? 'terminal']);
    if (state.claims[key]) return;
    // 推送只携带已有来源摘要；不把原路径、正文或可执行审批意图带出。
    const directSession = { eventKey: key, turnId: observation.turnId, machineId: params.machineId,
      ...(params.accountId ? { accountId: params.accountId, notificationIdentity: current.identity } : {}) };
    const base = { sessionId: params.sessionId, directSession };
    const event: ActivityNotificationEvent = topic === 'ready' ? { ...base, topic, waitingForCommandLabel: 'Codex' }
      : topic === 'session_failed' ? { ...base, topic }
      : { ...base, topic, requestId: requestId!, toolName: 'Codex Desktop' };
    // claim 在发送之前落盘。崩溃后无法证明提交结果，只能保持 unknown，不重放。
    state.claims[key] = { id: params.claimId, turnId: observation.turnId, status: 'unknown', reason: 'claimed' };
    events.push({ key, event });
  };
  // 连续 patch/forward 事件已证明发生在关注之后；短任务可首见终态，不能被当作历史吞掉。
  if (observation.state === 'completed') add('ready');
  if (observation.state === 'failed') add('session_failed');
  if (observation.state === 'needs_input') for (const request of observation.requests) add(request.kind, request.requestId);
  return { state, events };
}
