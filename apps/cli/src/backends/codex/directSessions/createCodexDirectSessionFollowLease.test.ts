import { createServer, type Socket } from 'node:net';
import { appendFile, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

// Logger 会按目录清理日志；使用本测试专属目录，不能把整个临时目录交给清理器。
const environment = await vi.hoisted(async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { activeServerDir: '', logsDir: await mkdtemp(join(tmpdir(), 'codextop-follow-logs-')) };
});
// 配置为环境边界；来源解析、真实文件轮询、socket 分帧和 lease 均使用正式实现。
vi.mock('@/configuration', () => ({ configuration: environment }));
import { createCodexDirectSessionFollowLease } from './createCodexDirectSessionFollowLease';
import type { DirectSessionTranscriptUpdate } from '@/api/directSessions/backgroundFollow/createManagedDirectSessionFollowLease';

afterEach(() => vi.unstubAllEnvs());
afterAll(() => rm(environment.logsDir, { recursive: true, force: true }));

/** 使用真正的第三方 socket 帧与独立 rollout；只替换配置边界，不 mock 内部状态归约。 */
async function createFallbackHarness(options: { baseline?: { turnId: string; status: string; runtime?: string }; holdBaseline?: boolean;
  missingSource?: boolean; initialCursor?: string; holdUpdates?: boolean } = {}) {
  const root = await mkdtemp('/tmp/hcf-fallback-');
  environment.activeServerDir = join(root, 'state');
  const remoteSessionId = '33333333-3333-3333-3333-333333333333';
  await mkdir(join(root, 'ipc'), { mode: 0o700 });
  await mkdir(join(root, 'sessions'));
  const path = join(root, 'sessions', `rollout-2026-09-23-${remoteSessionId}.jsonl`);
  const meta = `${JSON.stringify({ type: 'session_meta', payload: { id: remoteSessionId } })}\n`;
  // 订阅前已有的历史终态必须留在初始 tail 之前。
  await writeFile(path, meta + `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'historical' } })}\n`);
  if (options.missingSource) await rm(path);
  vi.stubEnv('HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS', '10');
  const sockets = new Set<Socket>();
  const followers: Socket[] = [];
  const updates: DirectSessionTranscriptUpdate[] = [];
  const historyRequests: Array<{ socket: Socket; requestId: string }> = [];
  let roundTrips = 0;
  let resumeUpdates: (() => void) | undefined;
  const updateGate = options.holdUpdates ? new Promise<void>((resolve) => { resumeUpdates = resolve; }) : undefined;
  /** 沿原协议写入四字节长度前缀，保留真实分帧和事件顺序。 */
  function send(socket: Socket, value: unknown) {
    const body = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    socket.write(Buffer.concat([header, body]));
  }
  /** 发布已知旧基线后的完整合成状态，由正式 DesktopIpc 决定是否确认。 */
  function snapshot(socket: Socket, revision: number, turnId?: string, status = 'inProgress', requests: unknown[] = [],
    precedingTurns = [{ turnId: 'base', status: 'completed' }]) {
    send(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner',
      params: { hostId: 'local', conversationId: remoteSessionId, change: { type: 'snapshot', revision,
        conversationState: { id: remoteSessionId, requests, threadRuntimeStatus: { type: turnId && status === 'inProgress' ? 'active' : 'idle' },
          turns: [...precedingTurns.map((turn) => ({ ...turn, items: [] })), ...(turnId ? [{ turnId, status, items: [] }] : [])] } } } });
  }
  /** 返回本次请求关联的原 owner 快照；没有指定基线时模拟缺失当前轮，保留原 fallback 用例。 */
  function replyBaseline(state = options.baseline, index = historyRequests.length - 1) {
    const request = historyRequests[index]!;
    if (request.socket.destroyed) return;
    send(request.socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner',
      params: { hostId: 'local', conversationId: remoteSessionId, change: { type: 'snapshot', revision: 7,
        conversationState: { id: remoteSessionId, requests: [], threadRuntimeStatus: { type: state?.runtime ?? (state?.status === 'inProgress' ? 'active' : 'idle') },
          turns: state ? [{ turnId: state.turnId, status: state.status, items: [] }] : [] } } } });
    send(request.socket, { type: 'response', requestId: request.requestId, method: 'thread-follower-load-complete-history',
      resultType: 'success', handledByClientId: 'owner', result: { revision: 7 } });
  }
  /** 模拟原 owner 的明确协议拒绝或暂时超时，保留正式失败与重连路径。 */
  function rejectBaseline(error = 'no-handler-for-request') {
    const request = historyRequests.at(-1)!;
    send(request.socket, { type: 'response', requestId: request.requestId, method: 'thread-follower-load-complete-history',
      resultType: 'error', error });
  }
  /** 仅模拟 initialize、owner 发现、一次只读历史关联与订阅；永不执行业务动作。 */
  const server = createServer((socket) => {
    // 连接关闭后从本例资源集合移除；测试结束仍统一清理其他连接。
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let bytes = Buffer.alloc(0);
    /** 保留真实粘包/拆包处理，按请求返回合成第三方响应。 */
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      while (bytes.length >= 4 && bytes.length >= bytes.readUInt32LE(0) + 4) {
        const size = bytes.readUInt32LE(0);
        const request = JSON.parse(bytes.subarray(4, size + 4).toString()) as { requestId: string; method: string; params?: { following?: boolean } };
        bytes = bytes.subarray(size + 4);
        if (request.method === 'initialize' || request.method === 'thread-owner-discovery') {
          const initializing = request.method === 'initialize';
          send(socket, { type: 'response', requestId: request.requestId, method: request.method, resultType: 'success',
            handledByClientId: initializing ? 'follower' : 'owner',
            result: initializing ? { clientId: 'follower' } : { supportsUntrustedAppInput: true } });
        } else if (request.method === 'thread-stream-following-changed' && request.params?.following) {
          if (!followers.includes(socket)) followers.push(socket);
          snapshot(socket, 1);
        } else if (request.method === 'thread-follower-load-complete-history') {
          historyRequests.push({ socket, requestId: request.requestId });
          if (!options.holdBaseline) replyBaseline();
        } else if (request.requestId === 'test-read-boundary') {
          roundTrips += 1;
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(join(root, 'ipc', 'ipc.sock'), resolve));
  let lease: Awaited<ReturnType<typeof createCodexDirectSessionFollowLease>>;
  /** 每次创建真实新 lease 并订阅正式更新，不保留旧租约的状态或游标。 */
  async function openLease(initialCursor?: string) {
    lease = await createCodexDirectSessionFollowLease({ source: { kind: 'codexHome', home: 'user', homePath: root }, remoteSessionId, initialCursor });
    lease.subscribeToTranscriptUpdates?.(async (update) => { updates.push(update); await updateGate; });
    if (!options.missingSource) await vi.waitFor(() => expect(lease.getTailCursor?.()).toEqual(expect.any(String)));
  }
  await openLease(options.initialCursor);
  if (!options.missingSource && !options.initialCursor) await vi.waitFor(() => expect(followers).toHaveLength(1));
  // 首份 snapshot 的确认也会推进初始游标；等待它完成后才开始测试前向追加。
  if (!options.missingSource) await vi.waitFor(() => expect(lease.getTailCursor?.()).toEqual(expect.any(String)));
  /** 通过真实前向游标确认一条完整行已被轮询消费，不使用固定等待时长。 */
  async function append(type: string, turnId?: string) {
    const before = lease.getTailCursor?.();
    await appendFile(path, `${JSON.stringify({ type: 'event_msg', payload: { type, ...(turnId ? { turn_id: turnId } : {}) } })}\n`);
    await vi.waitFor(() => expect(lease.getTailCursor?.()).not.toBe(before));
  }
  /** 释放本例全部 listener、socket 和临时目录，不触碰真实 Codex 数据。 */
  async function close() {
    resumeUpdates?.();
    await lease.release();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
  /** 用正式接收器的未知请求应答建立 socket 往返屏障，避免把尚未到达当作没有请求。 */
  async function roundTrip() {
    const before = roundTrips;
    send([...sockets][0]!, { type: 'request', method: 'test-read-boundary', requestId: 'test-read-boundary' });
    await vi.waitFor(() => expect(roundTrips).toBeGreaterThan(before));
  }
  return { /** 始终取最近一次创建的真实租约。 */ get lease() { return lease; },
    path, meta, followers, updates, remoteSessionId, snapshot, append, close, openLease, historyRequests, replyBaseline, rejectBaseline, send,
    roundTrip,
    /** 仅释放测试消费者的提交屏障，让正式轮询继续读取下一批。 */ resumeUpdates: () => resumeUpdates?.() };
}

/** 首次真实超时后由原 poller 恢复一次；没有新正文事件也能取得已关联的当前终态。 */
it('recovers a timed-out initial baseline once without waiting for a new rollout event', async () => {
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    const before = harness.lease.getObservation?.();
    expect(before).toMatchObject({ state: 'unknown' });
    // 首请求完全不应答，经过正式 DesktopIpc 的 15 秒只读期限后仅恢复一次。
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2), { timeout: 17_000 });
    expect(harness.historyRequests[0]!.socket).not.toBe(harness.historyRequests[1]!.socket);
    harness.replyBaseline({ turnId: 'recovered-idle', status: 'completed' });
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', source: 'desktop', turnId: 'recovered-idle' }));
    await vi.waitFor(() => expect(harness.updates.flatMap((update) => update.observations ?? []).some((fact) =>
      fact.continuity === 'snapshot' && fact.observation.state === 'completed')).toBe(true));
    expect(harness.historyRequests).toHaveLength(2);
  } finally { await harness.close(); }
});

/** 第二次仍失败就维持未知；随后正常重连不能变成重复全历史水合循环。 */
it('stops initial baseline recovery after a second transient failure', async () => {
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.followers).toHaveLength(3));
    await harness.append('agent_message');
    await harness.roundTrip();
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    expect(harness.historyRequests).toHaveLength(2);
  } finally { await harness.close(); }
});

/** 等待原消费链提交时来源失效，恢复预算也不能越过失效边界去新建连接。 */
it('does not reconnect a pending baseline recovery while its source is unavailable', async () => {
  const harness = await createFallbackHarness({ holdBaseline: true, holdUpdates: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    // 初始空 tail 不通知消费者；先追加中性事件并确认真实批次已进入门控，再制造失败。
    await appendFile(harness.path, `${JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'synthetic boundary' } })}\n`);
    await vi.waitFor(() => expect(harness.updates.length).toBeGreaterThan(0));
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.historyRequests[0]!.socket.destroyed).toBe(true));
    await rm(harness.path);
    harness.resumeUpdates();
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' }));
    expect(harness.followers).toHaveLength(1);
    expect(harness.historyRequests).toHaveLength(1);
  } finally { await harness.close(); }
});

/** 恢复请求也遵守原租约的释放和前向事实边界，迟到基线不能改写它们。 */
it.each(['forward', 'source', 'release'])('does not publish a recovery baseline after %s invalidates its boundary', async (change) => {
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    if (change === 'forward') await harness.append('task_started', 'new-running');
    else if (change === 'source') {
      await writeFile(harness.path, harness.meta);
      await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' }));
    } else await harness.lease.release();
    harness.replyBaseline({ turnId: 'old-idle', status: 'completed' });
    if (change !== 'release') await harness.append('agent_message');
    expect(harness.lease.getObservation?.()).toMatchObject(change === 'forward'
      ? { state: 'running', source: 'rollout', turnId: 'new-running' } : { state: 'unknown' });
    expect(harness.updates.flatMap((update) => update.observations ?? []).some((fact) => fact.observation.state === 'completed')).toBe(false);
    expect(harness.historyRequests).toHaveLength(2);
  } finally { await harness.close(); }
});

/** 首批来源不可用时根本不请求基线；恢复连续来源后才允许这份租约唯一一次读取。 */
it('waits for an available source before requesting its cold baseline', async () => {
  const harness = await createFallbackHarness({ missingSource: true, holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' }));
    await harness.roundTrip();
    expect(harness.historyRequests).toHaveLength(0);
    await writeFile(harness.path, harness.meta);
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    harness.replyBaseline({ turnId: 'current', status: 'completed' });
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', turnId: 'current' }));
  } finally { await harness.close(); }
});

/** 首批游标断代必须先由既有提交链确认新边界，不能在该批次请求或采用当前快照。 */
it('does not request a cold baseline in the initial discontinuity batch', async () => {
  const harness = await createFallbackHarness({ initialCursor: 'invalid-cursor', holdUpdates: true, holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.updates.length).toBeGreaterThan(0));
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' });
    expect(harness.historyRequests).toHaveLength(0);
    harness.resumeUpdates();
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    harness.replyBaseline({ turnId: 'current', status: 'completed' });
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', turnId: 'current' }));
  } finally { await harness.close(); }
});

/** 已有 source_unavailable 对象再次遇到失效也要废弃请求，不能只比较对象身份。 */
it('invalidates a pending baseline even when repeated source failure keeps the same unknown value', async () => {
  const harness = await createFallbackHarness({ missingSource: true, holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' }));
    await writeFile(harness.path, harness.meta + `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'historical' } })}\n`);
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    const before = harness.lease.getTailCursor?.();
    // 原子替换避免测试把半次 writeFile 的瞬时空文件混入明确来源断代。
    await writeFile(`${harness.path}.replacement`, harness.meta);
    await rename(`${harness.path}.replacement`, harness.path);
    await vi.waitFor(() => expect(harness.lease.getTailCursor?.()).not.toBe(before));
    harness.replyBaseline({ turnId: 'old', status: 'completed' });
    await harness.append('agent_message');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    expect(harness.updates.flatMap((update) => update.observations ?? []).some((fact) => fact.observation.state === 'completed')).toBe(false);
  } finally { await harness.close(); }
});

/** 静止任务首次打开也能显示可信终态；水合历史只能以快照进入消费链。 */
it('uses one cold baseline for a static completed task without emitting a historical completion event', async () => {
  const harness = await createFallbackHarness({ baseline: { turnId: 'historical', status: 'completed' } });
  try {
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', turnId: 'historical' }));
    await harness.append('agent_message');
    expect(harness.historyRequests).toHaveLength(1);
    expect(harness.updates.flatMap((update) => update.observations ?? []).filter((fact) => fact.observation.state !== 'unknown'))
      .toEqual([{ continuity: 'snapshot', observation: { v: 1, source: 'desktop', state: 'completed', turnId: 'historical' } }]);
    await harness.append('task_started', 'next');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'running', source: 'rollout', turnId: 'next' });
    await harness.append('task_complete', 'next');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', source: 'rollout', turnId: 'next' });
  } finally { await harness.close(); }
});

/** 不同 scope 的 confirmed 不够；仅 canonical 尾岛明确包含基线且新轮在后时才接替。 */
it.each([true, false])('adopts a later Desktop turn only with cold baseline ordering proof: %s', async (ordered) => {
  const harness = await createFallbackHarness({ baseline: { turnId: 'historical', status: 'completed' } });
  try {
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', turnId: 'historical' }));
    await harness.roundTrip();
    harness.snapshot(harness.followers[0]!, 2, 'next', 'inProgress', [], [
      { turnId: 'base', status: 'completed' }, ...(ordered ? [{ turnId: 'historical', status: 'completed' }] : []),
    ]);
    await harness.roundTrip();
    expect(harness.lease.getObservation?.()).toMatchObject(ordered
      ? { state: 'running', turnId: 'next' }
      : { state: 'completed', turnId: 'historical' });
    expect(harness.historyRequests).toHaveLength(1);
  } finally { await harness.close(); }
});

/** 无 viewer 的空档内完成后，新 lease 以一次当前快照恢复，不重放已在 tail 之前的事件。 */
it('recovers completion during a released viewer gap with the next lease cold baseline', async () => {
  const options = { baseline: { turnId: 'current', status: 'inProgress' } };
  const harness = await createFallbackHarness(options);
  try {
    await harness.append('task_started', 'current');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'running', turnId: 'current' });
    await harness.lease.release();
    await appendFile(harness.path, `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'current' } })}\n`);
    options.baseline.status = 'completed';
    harness.updates.length = 0;
    await harness.openLease();
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', turnId: 'current' }));
    await harness.append('agent_message');
    expect(harness.historyRequests).toHaveLength(2);
    expect(harness.updates.flatMap((update) => update.observations ?? []).filter((fact) => fact.observation.state !== 'unknown'))
      .toEqual([{ continuity: 'snapshot', observation: { v: 1, source: 'desktop', state: 'completed', turnId: 'current' } }]);
  } finally { await harness.close(); }
});

/** 等待基线时的新事实先行；迟到历史与已经释放的租约都不能复活旧轮。 */
it.each(['forward', 'release'] as const)('does not apply a delayed cold baseline after %s', async (change) => {
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    if (change === 'forward') {
      await harness.append('task_started', 'new');
      expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'running', turnId: 'new' });
    } else await harness.lease.release();
    harness.replyBaseline({ turnId: 'old', status: 'completed' });
    if (change === 'forward') {
      await harness.append('agent_message');
      expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'running', turnId: 'new' });
    } else expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'connection_closed' });
    expect(harness.updates.flatMap((update) => update.observations ?? []).some((fact) => fact.observation.state === 'completed')).toBe(false);
  } finally { await harness.close(); }
});

/** 同轮已明确完成后，迟到的运行基线也不能回退它。 */
it('rejects a delayed running cold baseline after the same turn completes forward', async () => {
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    await harness.append('task_complete', 'current');
    harness.replyBaseline({ turnId: 'current', status: 'inProgress' });
    await harness.append('agent_message');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', source: 'rollout', turnId: 'current' });
  } finally { await harness.close(); }
});

/** 既有通知游标恢复后已读到的新轮事实，不被随后开始的一次基线读取改写。 */
it('keeps facts restored from an existing cursor ahead of a later cold baseline', async () => {
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    const cursor = harness.lease.getTailCursor?.();
    expect(cursor).toEqual(expect.any(String));
    await harness.lease.release();
    await appendFile(harness.path, `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'new' } })}\n`);
    await harness.openLease(cursor!);
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'running', source: 'rollout', turnId: 'new' });
    harness.replyBaseline({ turnId: 'old', status: 'completed' });
    await harness.append('agent_message');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'running', source: 'rollout', turnId: 'new' });
  } finally { await harness.close(); }
});

/** 一次请求明确失败后只重连订阅；前向读取继续可用，不能循环请求 history。 */
it('continues forward observation after the single cold baseline request fails', async () => {
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    harness.rejectBaseline();
    await vi.waitFor(() => expect(harness.followers).toHaveLength(2));
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    await harness.append('task_started', 'new');
    await harness.append('task_complete', 'new');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', source: 'rollout', turnId: 'new' });
    expect(harness.historyRequests).toHaveLength(1);
  } finally { await harness.close(); }
});

/** 等待关联应答时发生来源断代，旧请求不能重新证明新来源的当前状态。 */
it('rejects a delayed cold baseline after its rollout boundary changes', async () => {
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    await writeFile(harness.path, harness.meta);
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' }));
    harness.replyBaseline({ turnId: 'old', status: 'completed' });
    await harness.append('agent_message');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    expect(harness.updates.flatMap((update) => update.observations ?? []).some((fact) => fact.observation.state === 'completed')).toBe(false);
  } finally { await harness.close(); }
});

/** 复用控制投影器拒绝 runtime 与尾轮矛盾，不让历史终态或旧运行轮冒充当前状态。 */
it.each([
  { status: 'completed', runtime: 'active' },
  { status: 'inProgress', runtime: 'idle' },
])('rejects a cold baseline with $status and $runtime runtime', async ({ status, runtime }) => {
  const harness = await createFallbackHarness({ baseline: { turnId: 'contradictory', status, runtime } });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    await harness.append('agent_message');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    expect(harness.updates.flatMap((update) => update.observations ?? []).every((fact) => fact.observation.state === 'unknown')).toBe(true);
    await harness.append('task_started', 'new');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'running', source: 'rollout', turnId: 'new' });
  } finally { await harness.close(); }
});

/** 一次基线不意味着连接永远健康；断代重连只订阅，不触发下一次广播水合。 */
it('invalidates a cold baseline on a real revision gap without loading history again on reconnect', async () => {
  const harness = await createFallbackHarness({ baseline: { turnId: 'historical', status: 'completed' } });
  try {
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed' }));
    await harness.append('agent_message');
    harness.send(harness.followers[0]!, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner',
      params: { hostId: 'local', conversationId: harness.remoteSessionId, change: { type: 'patches', baseRevision: 55, revision: 56, patches: [] } } });
    await vi.waitFor(() => expect(harness.followers).toHaveLength(2));
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    await harness.append('agent_message');
    expect(harness.historyRequests).toHaveLength(1);
    await harness.append('task_started', 'new');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'running', turnId: 'new' });
  } finally { await harness.close(); }
});

/** 文件来源变化也会撤销依赖连续读取维持的基线，不能保留一个永久 Desktop 优先值。 */
it.each(['removed', 'rewritten'] as const)('invalidates a cold baseline when rollout is %s', async (change) => {
  const harness = await createFallbackHarness({ baseline: { turnId: 'historical', status: 'completed' } });
  try {
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed' }));
    // 先确认原来源的前向边界已提交，再验证撤销；等待 getter 不代表初始批次已提交。
    await harness.append('agent_message');
    if (change === 'removed') await rm(harness.path);
    else await writeFile(harness.path, harness.meta);
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' }));
    expect(harness.historyRequests).toHaveLength(1);
  } finally { await harness.close(); }
});

/** 连接未知时连续采用开始与完成，订阅之前的历史终态不能重放。 */
it('uses successive forward rollout facts while Desktop stays connected but unknown, without replaying history', async () => {
  const harness = await createFallbackHarness();
  try {
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    await harness.append('task_started', 'current');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'running', turnId: 'current' });
    await harness.append('task_complete', 'current');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'completed', turnId: 'current' });
    expect(harness.updates.flatMap((update) => update.observations ?? []).filter((fact) => fact.observation.state !== 'unknown'))
      .toEqual([
        { continuity: 'event', observation: { v: 1, source: 'rollout', state: 'running', turnId: 'current' } },
        { continuity: 'event', observation: { v: 1, source: 'rollout', state: 'completed', turnId: 'current' } },
      ]);
  } finally { await harness.close(); }
});

/** 删除和重写都撤销已采用的文件事实，不受 IPC 对象是否仍在影响。 */
it.each(['removed', 'rewritten'] as const)('invalidates selected rollout after its source is %s even with Desktop connected', async (failure) => {
  const harness = await createFallbackHarness();
  try {
    await harness.append('task_complete', 'current');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'completed' });
    if (failure === 'removed') await rm(harness.path);
    else await writeFile(harness.path, harness.meta);
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' }));
  } finally { await harness.close(); }
});

/** 分别证明跨轮晚到和同轮回运行被拒绝，且不会阻止下一条前向 rollout 开始。 */
it.each(['late-other-turn', 'current'])('retains selected rollout across reconnect unknowns and rejects late Desktop running for %s', async (lateTurn) => {
  const harness = await createFallbackHarness();
  try {
    await harness.append('task_complete', 'current');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'completed' });
    harness.followers[0]!.destroy();
    await vi.waitFor(() => expect(harness.followers).toHaveLength(2));
    await harness.append('agent_message');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'completed', turnId: 'current' });
    harness.snapshot(harness.followers[1]!, 2, lateTurn);
    await harness.append('agent_message');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'completed', turnId: 'current' });
    await harness.append('task_started', 'current');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'completed', turnId: 'current' });
    // 被拒绝的 Desktop 晚到事实不能重新堵住后面的明确新轮。
    await harness.append('task_started', 'next');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'running', turnId: 'next' });
  } finally { await harness.close(); }
});

/** 同轮审批只能采用 Desktop 原生事实，掉线后不得复活已被它替代的旧运行事实。 */
it('allows a trusted same-turn Desktop approval to replace rollout running instead of inventing approval facts', async () => {
  const harness = await createFallbackHarness();
  try {
    await harness.append('task_started', 'current');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'running' });
    harness.snapshot(harness.followers[0]!, 2, 'current', 'inProgress', [{ id: 'request', method: 'item/commandExecution/requestApproval',
      params: { threadId: harness.remoteSessionId, turnId: 'current' } }]);
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ source: 'desktop', state: 'needs_input', turnId: 'current' }));
    harness.followers[0]!.destroy();
    await vi.waitFor(() => expect(harness.followers).toHaveLength(2));
    // 已被审批事实替代的旧 running 不能在掉线后被重新当作当前状态。
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    await harness.append('task_complete', 'current');
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'completed' });
  } finally { await harness.close(); }
});

it.each(['removed', 'rewritten'] as const)('retains explicit rollout facts across unavailable Desktop probes and invalidates a %s source', async (failure) => {
  const root = await mkdtemp('/tmp/hcf-rollout-');
  environment.activeServerDir = join(root, 'state');
  const remoteSessionId = '22222222-2222-2222-2222-222222222222';
  await mkdir(join(root, 'sessions'));
  const path = join(root, 'sessions', `rollout-2026-09-23-${remoteSessionId}.jsonl`);
  await writeFile(path, `${JSON.stringify({ type: 'session_meta', payload: { id: remoteSessionId } })}\n`);
  vi.stubEnv('HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS', '10');
  const lease = await createCodexDirectSessionFollowLease({ source: { kind: 'codexHome', home: 'user', homePath: root }, remoteSessionId });
  lease.subscribeToTranscriptUpdates?.(() => {});
  try {
    await appendFile(path, `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'current' } })}\n`);
    await vi.waitFor(() => expect(lease.getObservation?.()).toMatchObject({ state: 'completed', source: 'rollout', turnId: 'current' }));
    const before = lease.getTailCursor?.();
    // 普通消息只推进同一读取边界，不提供新的生命周期事实。
    await appendFile(path, `${JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'synthetic message' } })}\n`);
    await vi.waitFor(() => expect(lease.getTailCursor?.()).not.toBe(before));
    expect(lease.getObservation?.()).toMatchObject({ state: 'completed', source: 'rollout', turnId: 'current' });
    if (failure === 'removed') await rm(path);
    else await writeFile(path, `${JSON.stringify({ type: 'session_meta', payload: { id: remoteSessionId } })}\n`);
    await vi.waitFor(() => expect(lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' }));
  } finally {
    await lease.release();
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

it('invalidates the live getter on disconnect and release, and reconfirms after the existing poller reconnects', async () => {
  const root = await mkdtemp('/tmp/hcf-');
  environment.activeServerDir = join(root, 'state');
  const remoteSessionId = '11111111-1111-1111-1111-111111111111';
  await mkdir(join(root, 'ipc'), { mode: 0o700 });
  await mkdir(join(root, 'sessions'));
  await writeFile(join(root, 'sessions', `rollout-2026-09-23-${remoteSessionId}.jsonl`),
    `${JSON.stringify({ type: 'session_meta', payload: { id: remoteSessionId } })}\n`);
  vi.stubEnv('HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS', '100');
  const sockets = new Set<Socket>();
  const followers: Socket[] = [];
  /** 独立模拟第三方帧边界，不 mock 内部 DesktopIpc 或 transcript reader。 */
  const send = (socket: Socket, value: unknown) => {
    const body = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    socket.write(Buffer.concat([header, body]));
  };
  const snapshot = (socket: Socket, current: boolean) => send(socket, {
    type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner',
    params: { hostId: 'local', conversationId: remoteSessionId, change: { type: 'snapshot', revision: current ? 294 : 258,
      conversationState: { id: remoteSessionId, requests: [], turns: [
        { turnId: 'old', status: 'completed', items: [] },
        ...(current ? [{ turnId: 'current', status: 'inProgress', items: [] }] : []),
      ] },
    } },
  });
  const server = createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let bytes = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      while (bytes.length >= 4 && bytes.length >= bytes.readUInt32LE(0) + 4) {
        const length = bytes.readUInt32LE(0);
        const request = JSON.parse(bytes.subarray(4, length + 4).toString()) as {
          requestId: string; method: string; params: { following?: boolean };
        };
        bytes = bytes.subarray(length + 4);
        if (request.method === 'initialize' || request.method === 'thread-owner-discovery') {
          const initializing = request.method === 'initialize';
          send(socket, { type: 'response', requestId: request.requestId, method: request.method, resultType: 'success',
            handledByClientId: initializing ? 'follower' : 'owner',
            result: initializing ? { clientId: 'follower' } : { supportsUntrustedAppInput: true } });
        } else if (request.method === 'thread-stream-following-changed' && request.params.following) {
          if (!followers.includes(socket)) followers.push(socket);
          snapshot(socket, false);
        } else if (request.method === 'thread-follower-load-complete-history') {
          // 旧断线用例没有可验证 runtime；关联回执合法，基线投影仍应拒绝并进入原长订阅。
          send(socket, { type: 'response', requestId: request.requestId, method: request.method, resultType: 'success',
            handledByClientId: 'owner', result: { revision: 258 } });
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(join(root, 'ipc', 'ipc.sock'), resolve));
  let lease: Awaited<ReturnType<typeof createCodexDirectSessionFollowLease>> | undefined;
  try {
    lease = await createCodexDirectSessionFollowLease({ source: { kind: 'codexHome', home: 'user', homePath: root }, remoteSessionId });
    const unsubscribe = lease.subscribeToTranscriptUpdates?.(() => {});
    await vi.waitFor(() => expect(followers).toHaveLength(1));
    expect(lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    snapshot(followers[0]!, true);
    await vi.waitFor(() => expect(lease?.getObservation?.()).toMatchObject({ state: 'running', turnId: 'current' }));
    followers[0]!.destroy();
    await vi.waitFor(() => expect(lease?.getObservation?.()).toMatchObject({ state: 'unknown' }));
    await vi.waitFor(() => expect(followers).toHaveLength(2));
    expect(lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    snapshot(followers[1]!, true);
    await vi.waitFor(() => expect(lease?.getObservation?.()).toMatchObject({ state: 'running' }));
    const releasing = lease.release();
    expect(lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'connection_closed' });
    await releasing;
    unsubscribe?.();
  } finally {
    await lease?.release();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
