import { createServer, type Socket } from 'node:net';
import { appendFile, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
import { CONTROL_READ_TIMEOUT_MS } from './desktop/desktopIpc';
import { createCodexDirectSessionFollowLease } from './createCodexDirectSessionFollowLease';
import type { DirectSessionTranscriptUpdate } from '@/api/directSessions/backgroundFollow/createManagedDirectSessionFollowLease';

afterEach(() => vi.unstubAllEnvs());
afterAll(() => rm(environment.logsDir, { recursive: true, force: true }));

/** 使用真正的第三方 socket 帧与独立 rollout；只替换配置边界，不 mock 内部状态归约。 */
async function createFallbackHarness(options: { baseline?: { turnId: string; status: string; runtime?: string }; holdBaseline?: boolean;
  rolloutBaseline?: boolean; asyncRollout?: boolean; cleanSource?: boolean; missingSource?: boolean; initialCursor?: string; holdUpdates?: boolean; pollMs?: string } = {}) {
  const root = await mkdtemp('/tmp/hcf-fallback-');
  environment.activeServerDir = join(root, 'state');
  const remoteSessionId = '33333333-3333-3333-3333-333333333333';
  await mkdir(join(root, 'ipc'), { mode: 0o700 });
  await mkdir(join(root, 'sessions'));
  const path = join(root, 'sessions', `rollout-2026-09-23-${remoteSessionId}.jsonl`);
  const meta = `${JSON.stringify({ type: 'session_meta', payload: { id: remoteSessionId } })}\n`;
  // 订阅前已有的历史终态必须留在初始 tail 之前。
  await writeFile(path, meta + (options.cleanSource ? '' : `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'historical' } })}\n`));
  if (options.rolloutBaseline) {
    const timestamp = new Date().toISOString();
    await writeFile(path, meta + ['task_started', 'task_complete'].map((type) =>
      JSON.stringify({ type: 'event_msg', timestamp, payload: { type, turn_id: 'local-current' } }) + '\n').join(''));
  }
  if (options.asyncRollout) {
    const timestamp = new Date(Date.now() - 1000).toISOString();
    await writeFile(path, meta + JSON.stringify({ type: 'event_msg', timestamp, payload: { type: 'task_started', turn_id: 'current' } }) + '\n'
      + JSON.stringify({ type: 'response_item', timestamp, payload: { type: 'function_call', name: 'request_user_input_async', call_id: 'call-A',
        arguments: JSON.stringify({ questions: [{ title: '选择', options: ['甲', '乙'] }, { title: '补充' }] }) } }) + '\n');
  }
  if (options.missingSource) await rm(path);
  vi.stubEnv('HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS', options.pollMs ?? '10');
  const sockets = new Set<Socket>();
  const followers: Socket[] = [];
  const updates: DirectSessionTranscriptUpdate[] = [];
  const historyRequests: Array<{ socket: Socket; requestId: string; timeoutMs?: number }> = [];
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
    precedingTurns = [{ turnId: 'base', status: 'completed' }], items: unknown[] = []) {
    send(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner',
      params: { hostId: 'local', conversationId: remoteSessionId, change: { type: 'snapshot', revision,
        conversationState: { id: remoteSessionId, requests, threadRuntimeStatus: { type: turnId && status === 'inProgress' ? 'active' : 'idle' },
          turns: [...precedingTurns.map((turn) => ({ ...turn, items: [] })), ...(turnId ? [{ turnId, status, items }] : [])] } } } });
  }
  /** 返回本次请求关联的原 owner 快照；没有指定基线时模拟缺失当前轮，保留原 fallback 用例。 */
  function replyBaseline(state = options.baseline, index = historyRequests.length - 1, detail: { items?: unknown[]; revision?: number; responseRevision?: number; owner?: string; sourceClientId?: string; conflict?: boolean } = {}) {
    const request = historyRequests[index]!;
    if (request.socket.destroyed) return;
    const revision = detail.revision ?? 7;
    const owner = detail.owner ?? 'owner';
    const frame = (turnId: string | undefined, items: unknown[]) => send(request.socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: detail.sourceClientId ?? owner,
      params: { hostId: 'local', conversationId: remoteSessionId, change: { type: 'snapshot', revision,
        conversationState: { id: remoteSessionId, requests: [], threadRuntimeStatus: { type: state?.runtime ?? (state?.status === 'inProgress' ? 'active' : 'idle') },
          turns: turnId ? [{ turnId, status: state?.status ?? 'completed', items }] : [] } } } });
    if (detail.conflict) frame('conflict-turn', []);
    frame(state?.turnId, detail.items ?? []);
    send(request.socket, { type: 'response', requestId: request.requestId, method: 'thread-follower-load-complete-history',
      resultType: 'success', handledByClientId: owner, result: { revision: detail.responseRevision ?? revision } });
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
        const request = JSON.parse(bytes.subarray(4, size + 4).toString()) as { requestId: string; method: string; timeoutMs?: number; params?: { following?: boolean } };
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
          historyRequests.push({ socket, requestId: request.requestId, timeoutMs: request.timeoutMs });
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
  if (!options.rolloutBaseline && !options.asyncRollout && !options.missingSource && !options.initialCursor) await vi.waitFor(() => expect(followers).toHaveLength(1));
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
  /** 直接执行正式 poll 单飞，时钟边界测试无需等待真实 15 秒。 */
  async function poll() {
    if (!('pollNow' in lease) || typeof lease.pollNow !== 'function') throw new Error('missing real pollNow');
    await lease.pollNow();
  }
  return { /** 始终取最近一次创建的真实租约。 */ get lease() { return lease; },
    path, meta, followers, updates, remoteSessionId, snapshot, append, close, openLease, historyRequests, replyBaseline, rejectBaseline, send,
    roundTrip, poll,
    /** 仅释放测试消费者的提交屏障，让正式轮询继续读取下一批。 */ resumeUpdates: () => resumeUpdates?.() };
}

/** 恢复既有游标时，lease 先发布、原 poller 随后连接；控制等待这一次读取和关联基线。 */
it('waits for the existing source read before sharing a resumed lease baseline', async () => {
  const options = { baseline: { turnId: 'current', status: 'completed' }, holdBaseline: false };
  const harness = await createFallbackHarness(options);
  try {
    await vi.waitFor(() => expect(harness.lease.getProviderControl?.()).toBeTruthy());
    const cursor = harness.lease.getTailCursor?.();
    expect(cursor).toEqual(expect.any(String));
    await harness.lease.release();
    options.holdBaseline = true;
    await harness.openLease(cursor!);
    const ready = harness.lease.waitForProviderControl!().then(() => 'ready', () => 'unavailable');
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    harness.replyBaseline();
    expect(await ready).toBe('ready');
    expect(harness.lease.getProviderControl?.()).toBeTruthy();
    expect(harness.historyRequests).toHaveLength(2);
  } finally { await harness.close(); }
});

it('ends a control waiter while the same background history continues to a later valid state', async () => {
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const outcome = harness.lease.waitForProviderControl!().then(() => 'ready', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(CONTROL_READ_TIMEOUT_MS);
    await expect(outcome).resolves.toBe('timeout');
    expect(harness.historyRequests[0]!.socket.destroyed).toBe(false);
    expect(harness.historyRequests).toHaveLength(1);
    vi.useRealTimers();
    harness.replyBaseline({ turnId: 'late-valid', status: 'completed' });
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', turnId: 'late-valid' }));
    expect(harness.historyRequests).toHaveLength(1);
  } finally { vi.useRealTimers(); await harness.close(); }
});

/** 首次完整历史超时也等待原预算，不立即重复读取；静止来源仍可恢复。 */
it('pauses the first history timeout before recovering without a new rollout event', async () => {
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.historyRequests[0]!.socket.destroyed).toBe(true));
    for (let index = 0; index < 20; index += 1) await harness.poll();
    const budget = CONTROL_READ_TIMEOUT_MS;
    now += budget - 1;
    await harness.poll();
    expect(harness.historyRequests).toHaveLength(1);
    expect(harness.followers).toHaveLength(1);
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    now += 1;
    await harness.poll();
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    harness.replyBaseline({ turnId: 'recovered-idle', status: 'completed' });
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', source: 'desktop', turnId: 'recovered-idle' }));
    expect(harness.lease.getProviderControl?.()).toBeTruthy();
  } finally { await harness.close(); clock.mockRestore(); }
});

/** 后续暂时失败按原 history 预算暂停；静止来源恢复后无需新事件或重建 lease。 */
it('pauses repeated transient baseline failures for the history budget and recovers the same static lease', async () => {
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    const lease = harness.lease;
    const originalBytes = await readFile(harness.path);
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    const readBudgetMs = CONTROL_READ_TIMEOUT_MS;
    expect(harness.historyRequests[0]!.timeoutMs).toBe(305_000);
    harness.rejectBaseline('client-disconnected');
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.historyRequests.at(-1)!.socket.destroyed).toBe(true));
    for (let index = 0; index < 20; index += 1) await harness.poll();
    await expect(lease.waitForProviderControl!()).rejects.toThrow('owner_unavailable');
    now += readBudgetMs - 1;
    await harness.poll();
    expect(harness.historyRequests).toHaveLength(2);
    // following 自身会传完整快照；等待期不能通过普通订阅绕过退避。
    expect(harness.followers).toHaveLength(2);
    expect(lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    expect(lease.getProviderControl?.()).toBeNull();
    now += 1;
    await harness.poll();
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(3));
    // 第三次仍失败也必须重新暂停，不能重置为首次立即补试。
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.historyRequests.at(-1)!.socket.destroyed).toBe(true));
    now += readBudgetMs - 1;
    await harness.poll();
    expect(harness.historyRequests).toHaveLength(3);
    expect(harness.followers).toHaveLength(3);
    now += 1;
    await harness.poll();
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(4));
    harness.replyBaseline({ turnId: 'recovered-static', status: 'completed' });
    await vi.waitFor(() => expect(lease.getObservation?.()).toMatchObject({ state: 'completed', source: 'desktop', turnId: 'recovered-static' }));
    expect(lease.getProviderControl?.()).toBeTruthy();
    expect(harness.lease).toBe(lease);
    expect(await readFile(harness.path)).toEqual(originalBytes);
    expect(harness.updates.flatMap((update) => update.observations ?? []).filter((fact) => fact.observation.state === 'completed'))
      .toEqual([{ continuity: 'snapshot', observation: { v: 1, state: 'completed', source: 'desktop', turnId: 'recovered-static' } }]);
  } finally { await harness.close(); clock.mockRestore(); }
});

/** 暂停到期也不能越过释放、失效来源或已经采用的前向事实。 */
it.each(['release', 'source', 'forward'] as const)('does not restart a paused baseline after %s removes its recovery eligibility', async (change) => {
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    harness.rejectBaseline('client-disconnected');
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.historyRequests.at(-1)!.socket.destroyed).toBe(true));
    if (change === 'release') await harness.lease.release();
    else if (change === 'source') await rm(harness.path);
    else await harness.append('task_started', 'new-forward');
    now += CONTROL_READ_TIMEOUT_MS;
    await harness.poll();
    expect(harness.historyRequests).toHaveLength(2);
    expect(harness.lease.getProviderControl?.()).toBeNull();
    expect(harness.lease.getObservation?.()).toMatchObject(change === 'forward'
      ? { state: 'running', source: 'rollout', turnId: 'new-forward' }
      : { state: 'unknown', reason: change === 'release' ? 'connection_closed' : 'source_unavailable' });
  } finally { await harness.close(); clock.mockRestore(); }
});

/** 到期恢复仍等原批次 ACK，旧 pending 不得被控制等待或新读取绕过。 */
it('waits for the pending transcript batch before restarting a paused baseline', async () => {
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const harness = await createFallbackHarness({ holdBaseline: true });
  let acknowledge!: () => void;
  const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve; });
  let unsubscribe = () => {};
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    harness.rejectBaseline('client-disconnected');
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.historyRequests.at(-1)!.socket.destroyed).toBe(true));
    unsubscribe = harness.lease.subscribeToTranscriptUpdates!(async (update) => {
      if (Array.from(update.items).length) await acknowledgement;
    });
    const committedCursor = harness.lease.getTailCursor?.();
    await appendFile(harness.path, `${JSON.stringify({ type: 'response_item', payload: {
      type: 'message', role: 'assistant', content: [{ type: 'text', text: 'synthetic pending boundary' }],
    } })}\n`);
    const pendingPoll = harness.poll();
    await vi.waitFor(() => expect(harness.updates.flatMap((update) => Array.from(update.items))).toHaveLength(1));
    now += CONTROL_READ_TIMEOUT_MS;
    let joined = false;
    const joinedPoll = harness.poll().then(() => { joined = true; });
    await Promise.resolve();
    expect(joined).toBe(false);
    expect(harness.historyRequests).toHaveLength(2);
    expect(harness.lease.getTailCursor?.()).toBe(committedCursor);
    acknowledge();
    await Promise.all([pendingPoll, joinedPoll]);
    await harness.poll();
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(3));
    harness.replyBaseline({ turnId: 'after-pending', status: 'completed' });
    await vi.waitFor(() => expect(harness.lease.getProviderControl?.()).toBeTruthy());
    expect(harness.updates.flatMap((update) => Array.from(update.items))).toHaveLength(1);
    expect(harness.lease.getTailCursor?.()).not.toBe(committedCursor);
  } finally { acknowledge(); unsubscribe(); await harness.close(); clock.mockRestore(); }
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
    harness.rejectBaseline('client-disconnected');
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

/** 连续补丁也必须证明新轮在基线之后；移除基线不能凭当前尾项推断顺序。 */
it.each([true, false])('adopts a later Desktop turn only with cold baseline ordering proof: %s', async (ordered) => {
  const harness = await createFallbackHarness({ baseline: { turnId: 'historical', status: 'completed' } });
  try {
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', turnId: 'historical' }));
    await harness.roundTrip();
    harness.send(harness.followers[0]!, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner',
      params: { hostId: 'local', conversationId: harness.remoteSessionId, change: { type: 'patches', baseRevision: 7, revision: 8,
        patches: [{ op: 'replace', path: ['turns'], value: [
          { turnId: 'base', status: 'completed', items: [] }, ...(ordered ? [{ turnId: 'historical', status: 'completed', items: [] }] : []),
          { turnId: 'next', status: 'inProgress', items: [] },
        ] }, { op: 'replace', path: ['threadRuntimeStatus', 'type'], value: 'active' }] } } });
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
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const harness = await createFallbackHarness({ holdBaseline: true });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    harness.rejectBaseline();
    await vi.waitFor(() => expect(harness.followers).toHaveLength(2));
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    // 不支持的方法不是暂时传输失败；超过两个读取预算也不能重试 history。
    now += harness.historyRequests[0]!.timeoutMs! * 2;
    await harness.poll();
    await harness.roundTrip();
    expect(harness.historyRequests).toHaveLength(1);
    await harness.append('task_started', 'new');
    await harness.append('task_complete', 'new');
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', source: 'rollout', turnId: 'new' });
    expect(harness.historyRequests).toHaveLength(1);
  } finally { await harness.close(); clock.mockRestore(); }
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

/** 曾成功的连续控制连接失效后，原 poller 恢复一次关联基线，不等新正文才知道休眠期间完成。 */
it.each(['gap', 'disconnect', 'owner_changed'] as const)('revokes control on %s and restores a completed baseline on the next connection', async (failure) => {
  const options = { baseline: { turnId: 'current', status: 'inProgress' }, holdBaseline: false };
  const harness = await createFallbackHarness(options);
  try {
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'running', turnId: 'current' }));
    expect(harness.lease.getProviderControl?.()).toBeTruthy();
    await harness.append('agent_message');
    options.holdBaseline = true;
    if (failure === 'disconnect') harness.followers[0]!.destroy();
    else if (failure === 'owner_changed') harness.send(harness.followers[0]!, { type: 'broadcast', method: 'client-status-changed',
      params: { clientId: 'owner', status: 'disconnected' } });
    else harness.send(harness.followers[0]!, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner',
      params: { hostId: 'local', conversationId: harness.remoteSessionId, change: { type: 'patches', baseRevision: 55, revision: 56, patches: [] } } });
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    expect(harness.lease.getProviderControl?.()).toBeNull();
    harness.replyBaseline({ turnId: 'current', status: 'completed' });
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'completed', turnId: 'current' }));
    expect(harness.lease.getProviderControl?.()).toBeTruthy();
    await harness.append('agent_message');
    expect(harness.historyRequests).toHaveLength(2);
  } finally { await harness.close(); }
});

/** 断线前已读出的正文先由原消费链确认，控制不能绕过这份批次独立冷读。 */
it('recovers control after acknowledging the disconnected poll batch without rereading it', async () => {
  const options = { baseline: { turnId: 'current', status: 'completed' }, holdBaseline: false };
  const harness = await createFallbackHarness(options);
  let acknowledge!: () => void;
  const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve; });
  const unsubscribe = harness.lease.subscribeToTranscriptUpdates!(async (update) => {
    if (Array.from(update.items).length) await acknowledgement;
  });
  try {
    await vi.waitFor(() => expect(harness.lease.getProviderControl?.()).toBeTruthy());
    await appendFile(harness.path, `${JSON.stringify({ type: 'response_item', payload: {
      type: 'message', role: 'assistant', content: [{ type: 'text', text: 'synthetic boundary' }],
    } })}\n`);
    await vi.waitFor(() => expect(harness.updates.flatMap((update) => Array.from(update.items))).toHaveLength(1));
    const committedCursor = harness.lease.getTailCursor?.();
    options.holdBaseline = true;
    harness.followers[0]!.destroy();
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' }));
    let settled = false;
    const waiting = harness.lease.waitForProviderControl!().then(() => { settled = true; });
    await Promise.resolve();
    expect(harness.lease.getTailCursor?.()).toBe(committedCursor);
    expect(harness.historyRequests).toHaveLength(1);
    acknowledge();
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    expect(settled).toBe(false);
    harness.replyBaseline();
    await waiting;
    expect(harness.lease.getProviderControl?.()).toBeTruthy();
    expect(harness.updates.flatMap((update) => Array.from(update.items)).filter((item) => item.raw.role === 'agent')).toHaveLength(1);
    expect(harness.historyRequests).toHaveLength(2);
  } finally { acknowledge(); unsubscribe(); await harness.close(); }
});

/** 控制等待立即复用既有恢复读取；释放后不等待定时 tick 或接受迟到基线。 */
it('rejects a control waiter released during immediate recovery without waiting for the next scheduled poll', async () => {
  const options = { baseline: { turnId: 'current', status: 'completed' }, holdBaseline: false, pollMs: '60000' };
  const harness = await createFallbackHarness(options);
  try {
    await vi.waitFor(() => expect(harness.lease.getProviderControl?.()).toBeTruthy());
    options.holdBaseline = true;
    harness.followers[0]!.destroy();
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' }));
    const waiting = harness.lease.waitForProviderControl!().then(() => 'ready', () => 'unavailable');
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    expect(harness.lease.getProviderControl?.()).toBeNull();
    await harness.lease.release();
    expect(await waiting).toBe('unavailable');
    harness.replyBaseline();
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'connection_closed' });
    expect(harness.historyRequests).toHaveLength(2);
  } finally { await harness.close(); }
});

/** 恢复成功连接保留一次立即补试，后续失败进入暂停，不因快路径形成水合循环。 */
it('keeps reconnect hydration recovery bounded after an established control connection fails', async () => {
  const options = { baseline: { turnId: 'current', status: 'completed' }, holdBaseline: false };
  const harness = await createFallbackHarness(options);
  try {
    await vi.waitFor(() => expect(harness.lease.getProviderControl?.()).toBeTruthy());
    options.holdBaseline = true;
    harness.followers[0]!.destroy();
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(2));
    harness.rejectBaseline('client-disconnected');
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(3));
    harness.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(harness.historyRequests.at(-1)!.socket.destroyed).toBe(true));
    await harness.append('agent_message');
    await harness.poll();
    expect(harness.followers).toHaveLength(3);
    expect(harness.historyRequests).toHaveLength(3);
    expect(harness.lease.getProviderControl?.()).toBeNull();
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
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

/** 明确本地生命周期应直接成为观察基线，不为展示状态水合整份桌面历史。 */
it('observes an anchored local lifecycle without desktop full-history hydration', async () => {
  const harness = await createFallbackHarness({ rolloutBaseline: true, holdBaseline: true, pollMs: '60000' });
  try {
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toEqual({
      v: 1, source: 'rollout', turnId: 'local-current', state: 'completed',
    }));
    expect(harness.historyRequests).toHaveLength(0);
    expect(harness.followers).toHaveLength(0);
    expect(harness.lease.getProviderControl?.()).toBeNull();
    await appendFile(harness.path, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(),
      payload: { type: 'task_started', turn_id: 'local-next' } }) + '\n');
    await harness.poll();
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'running', turnId: 'local-next' });
    expect(harness.historyRequests).toHaveLength(0);
    // 源文件重写撤销原状态，恢复后的明确轮可由原轮询重新建立，不复活旧终态。
    await writeFile(harness.path, harness.meta);
    await harness.poll();
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'unknown' });
    await appendFile(harness.path, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(),
      payload: { type: 'task_started', turn_id: 'after-rewrite' } }) + '\n');
    await harness.poll();
    expect(harness.lease.getObservation?.()).toMatchObject({ state: 'running', turnId: 'after-rewrite' });
    expect(harness.historyRequests).toHaveLength(0);
  } finally { await harness.close(); }
});

const asyncQuestionId = (index: number) => JSON.stringify(['request_user_input_async', 'card-1', index]);
const asyncCard = { id: 'card-1', type: 'agentMessage', questions: [{ title: '选择', options: ['甲', '乙'] }, { title: '补充', options: [] }] };
/** 桌面逐题封套；身份是消息 item id，故意不等于 rollout 的 call-A。 */
function asyncReply(index: number, answer: string) {
  const question = index === 0 ? '选择' : '补充';
  return { type: 'steeringUserMessage', id: `reply-${index}`, status: 'accepted', targetTurnId: 'current',
    input: [{ type: 'text', text: `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: asyncQuestionId(index), question, answer }])}\n</send_user_message_question_reply>` }] };
}

/** 未答异步题才水合既有桌面基线；item id 与 call id 不同，整份观察按 2→1→running 替换。 */
it('adopts same-turn desktop async replies when the tool call id differs from the message item id', async () => {
  const harness = await createFallbackHarness({ asyncRollout: true, holdBaseline: true, baseline: { turnId: 'current', status: 'inProgress' }, pollMs: '20' });
  try {
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1));
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'needs_input', turnId: 'current', requests: [{ requestId: 'call-A' }] });
    harness.replyBaseline({ turnId: 'current', status: 'inProgress' }, 0, { items: [asyncCard] });
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ source: 'desktop', state: 'needs_input', turnId: 'current',
      requests: [{ requestId: asyncQuestionId(0) }, { requestId: asyncQuestionId(1) }] }));
    harness.snapshot(harness.historyRequests[0]!.socket, 8, 'current', 'inProgress', [], [{ turnId: 'base', status: 'completed' }], [asyncCard, asyncReply(0, '甲')]);
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ source: 'desktop', state: 'needs_input',
      requests: [{ requestId: asyncQuestionId(1) }] }));
    harness.snapshot(harness.historyRequests[0]!.socket, 9, 'current', 'inProgress', [], [{ turnId: 'base', status: 'completed' }], [asyncCard, asyncReply(0, '甲'), asyncReply(1, '补充答案')]);
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ source: 'desktop', state: 'running', turnId: 'current' }));
    expect(harness.lease.getObservation?.()).not.toMatchObject({ requests: expect.anything() });
  } finally { await harness.close(); }
});

/** 错轮、错修订、错 owner、超时、释放和来源中断都不能把未验证的桌面快照当成已答。 */
it('keeps local async pending when the desktop baseline is the wrong turn, revision, or owner', async () => {
  const wrongTurn = await createFallbackHarness({ asyncRollout: true, holdBaseline: true, baseline: { turnId: 'other', status: 'inProgress' }, pollMs: '20' });
  try {
    await vi.waitFor(() => expect(wrongTurn.historyRequests).toHaveLength(1));
    wrongTurn.replyBaseline();
    await wrongTurn.poll();
    expect(wrongTurn.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'needs_input', requests: [{ requestId: 'call-A' }] });
  } finally { await wrongTurn.close(); }
  const wrongRevision = await createFallbackHarness({ asyncRollout: true, holdBaseline: true, baseline: { turnId: 'current', status: 'inProgress' }, pollMs: '20' });
  try {
    await vi.waitFor(() => expect(wrongRevision.historyRequests).toHaveLength(1));
    wrongRevision.replyBaseline(undefined, 0, { items: [asyncCard], conflict: true });
    await vi.waitFor(() => expect(wrongRevision.historyRequests[0]!.socket.destroyed).toBe(true));
    await wrongRevision.poll();
    expect(wrongRevision.historyRequests).toHaveLength(1);
    expect(wrongRevision.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'needs_input', requests: [{ requestId: 'call-A' }] });
  } finally { await wrongRevision.close(); }
  const wrongOwner = await createFallbackHarness({ asyncRollout: true, holdBaseline: true, baseline: { turnId: 'current', status: 'inProgress' }, pollMs: '20' });
  try {
    await vi.waitFor(() => expect(wrongOwner.historyRequests).toHaveLength(1));
    wrongOwner.replyBaseline(undefined, 0, { items: [asyncCard], owner: 'stranger' });
    await vi.waitFor(() => expect(wrongOwner.historyRequests[0]!.socket.destroyed).toBe(true));
    await wrongOwner.poll();
    expect(wrongOwner.historyRequests).toHaveLength(1);
    expect(wrongOwner.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'needs_input' });
  } finally { await wrongOwner.close(); }
});

it('does not apply a late desktop reply after a new turn, release, timeout, or source discontinuity', async () => {
  const late = await createFallbackHarness({ asyncRollout: true, holdBaseline: true, baseline: { turnId: 'current', status: 'inProgress' }, pollMs: '20' });
  try {
    await vi.waitFor(() => expect(late.historyRequests).toHaveLength(1));
    await appendFile(late.path, `${JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_started', turn_id: 'next' } })}\n`);
    await vi.waitFor(() => expect(late.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'running', turnId: 'next' }));
    late.replyBaseline(undefined, 0, { items: [asyncCard] });
    await late.poll();
    expect(late.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'running', turnId: 'next' });
  } finally { await late.close(); }
  const released = await createFallbackHarness({ asyncRollout: true, holdBaseline: true, baseline: { turnId: 'current', status: 'inProgress' }, pollMs: '20' });
  try {
    await vi.waitFor(() => expect(released.historyRequests).toHaveLength(1));
    const releasing = released.lease.release();
    expect(released.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'connection_closed' });
    released.replyBaseline(undefined, 0, { items: [asyncCard] });
    await releasing;
    expect(released.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'connection_closed' });
  } finally { await released.close(); }
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const timedOut = await createFallbackHarness({ asyncRollout: true, holdBaseline: true, baseline: { turnId: 'current', status: 'inProgress' }, pollMs: '20' });
  try {
    await vi.waitFor(() => expect(timedOut.historyRequests).toHaveLength(1));
    timedOut.rejectBaseline('request-timeout');
    await vi.waitFor(() => expect(timedOut.historyRequests[0]!.socket.destroyed).toBe(true));
    await timedOut.poll();
    expect(timedOut.historyRequests).toHaveLength(1);
    expect(timedOut.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'needs_input', requests: [{ requestId: 'call-A' }] });
    now += CONTROL_READ_TIMEOUT_MS;
    await timedOut.poll();
    await vi.waitFor(() => expect(timedOut.historyRequests).toHaveLength(2));
  } finally { await timedOut.close(); clock.mockRestore(); }
  const broken = await createFallbackHarness({ asyncRollout: true, holdBaseline: true, baseline: { turnId: 'current', status: 'inProgress' }, pollMs: '20' });
  try {
    await vi.waitFor(() => expect(broken.historyRequests).toHaveLength(1));
    await rm(broken.path);
    await vi.waitFor(() => expect(broken.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' }));
    broken.replyBaseline(undefined, 0, { items: [asyncCard, asyncReply(0, '甲'), asyncReply(1, '补充答案')] });
    await broken.poll();
    expect(broken.lease.getObservation?.()).toMatchObject({ state: 'unknown', reason: 'source_unavailable' });
  } finally { await broken.close(); }
});

/** 先采用明确本地运行后，同一租约追加未答异步题必须重新打开既有基线，不能被旧 latch 永久跳过。 */
it('starts one desktop baseline after local running gains an async request in the same lease', async () => {
  const harness = await createFallbackHarness({ rolloutBaseline: true, holdBaseline: true, pollMs: '60000' });
  try {
    await appendFile(harness.path, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_started', turn_id: 'current' } }) + '\n');
    await harness.poll();
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'running', turnId: 'current' });
    expect(harness.historyRequests).toHaveLength(0);
    await appendFile(harness.path, JSON.stringify({ type: 'response_item', timestamp: new Date().toISOString(), payload: {
      type: 'function_call', name: 'request_user_input_async', call_id: 'new-call',
      arguments: JSON.stringify({ questions: [{ title: '题面', options: ['甲', '乙'] }] }),
    } }) + '\n');
    await harness.poll();
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'needs_input', turnId: 'current' });
    await vi.waitFor(() => expect(harness.historyRequests).toHaveLength(1), { timeout: 1200 });
  } finally { await harness.close(); }
});

/** 已验证的同轮桌面审批在下一次没有新来源事件的本地轮询后仍然有效。 */
it('retains a verified same-turn desktop approval across the next local poll', async () => {
  const harness = await createFallbackHarness({ cleanSource: true, pollMs: '60000' });
  try {
    await appendFile(harness.path, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_started', turn_id: 'current' } }) + '\n');
    await harness.poll();
    expect(harness.lease.getObservation?.()).toMatchObject({ source: 'rollout', state: 'running', turnId: 'current' });
    harness.snapshot(harness.followers[0]!, 2, 'current', 'inProgress', [{
      id: 'approval-id', method: 'item/commandExecution/requestApproval', params: { threadId: harness.remoteSessionId, turnId: 'current' },
    }]);
    await vi.waitFor(() => expect(harness.lease.getObservation?.()).toMatchObject({ source: 'desktop', state: 'needs_input', turnId: 'current' }));
    await harness.poll();
    expect(harness.lease.getObservation?.()).toMatchObject({
      source: 'desktop', state: 'needs_input', turnId: 'current', requests: [{ requestId: 'approval-id' }],
    });
  } finally { await harness.close(); }
});
