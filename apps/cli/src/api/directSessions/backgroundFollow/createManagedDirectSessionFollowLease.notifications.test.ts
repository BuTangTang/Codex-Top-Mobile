import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerMachineDirectSessionsRpcHandlers } from '@/api/machine/rpcHandlers.directSessions';
import { accountSettingsParse, RPC_METHODS, type DirectSessionObservationV1 } from '@happier-dev/protocol';
import { PushNotificationClient } from '@/api/pushNotifications';
import { setActiveAccountSettingsSnapshot, resetActiveAccountSettingsSnapshotForTests } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveAccountSettingsScopeKey } from '@/settings/accountSettings/accountSettingsScopeKey';
import { createManagedDirectSessionFollowLease, type DirectSessionTranscriptUpdateListener } from './createManagedDirectSessionFollowLease';
import { createPollingDirectSessionFollowLease } from './createPollingDirectSessionFollowLease';

const boundary = vi.hoisted(() => ({ wire: '', version: 1, send: vi.fn(), beforeAck: undefined as (() => void) | undefined,
  rejectMetadata: undefined as ((wire: string) => boolean) | undefined,
  beforeWrite: undefined as (() => Promise<void>) | undefined, dropNextAck: false }));
vi.mock('axios', () => ({ default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn(), isAxiosError: () => false } }));
// 凭据读取是外部边界，RPC 测试只使用本文件的合成账号。
vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(), readCredentials: async () => credentials,
}));
vi.mock('expo-server-sdk', () => ({ Expo: class {
  static isExpoPushToken() { return true; }
  chunkPushNotifications(messages: unknown[]) { return [messages]; }
  sendPushNotificationsAsync(messages: unknown[]) { return boundary.send(messages); }
  async getPushNotificationReceiptsAsync() { return {}; }
} }));
// 只替换真正 socket.io 边界；真实 CAS、解密、归约器和 dispatcher 均在测试中执行。
vi.mock('socket.io-client', async () => {
  const { EventEmitter } = await import('node:events');
  return { io: () => new class extends EventEmitter {
    connected = true;
    connect() { super.emit('connect'); }
    disconnect() {}
    close() {}
    emit(event: string, ...args: any[]): boolean {
      if (event !== 'update-metadata') return super.emit(event, ...args);
      const [payload, ack] = args;
      const write = () => {
        if (boundary.rejectMetadata?.(payload.metadata)) ack({ result: 'error' });
        else if (payload.expectedVersion !== boundary.version) ack({ result: 'version-mismatch', version: boundary.version, metadata: boundary.wire });
        else {
          boundary.wire = payload.metadata;
          boundary.version++;
          boundary.beforeAck?.();
          if (boundary.dropNextAck) { boundary.dropNextAck = false; return; }
          ack({ result: 'success', version: boundary.version, metadata: boundary.wire });
        }
      };
      const beforeWrite = boundary.beforeWrite;
      boundary.beforeWrite = undefined;
      if (beforeWrite) void beforeWrite().then(write);
      else write();
      return true;
    }
  } };
});

const credentials = { token: `synthetic.${Buffer.from(JSON.stringify({ sub: 'account' })).toString('base64url')}.signature`, encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(1) } };
const metadata = () => ({ summary: { text: 'Synthetic task' }, directSessionV1: {
  v: 1, providerId: 'codex', machineId: 'machine', remoteSessionId: 'native-thread', source: { kind: 'codexHome', home: 'user' },
  linkedAtMs: 1, followPolicyV1: { v: 1, policy: 'background_follow', generation: 'follow-1' },
} });
const rawSession = () => ({ id: 'linked', seq: 0, createdAt: 0, updatedAt: 0, active: false, activeAt: 0,
  metadata: boundary.wire, metadataVersion: boundary.version, encryptionMode: 'plain',
  dataEncryptionKey: null, agentState: null, agentStateVersion: 0 });
const fact = (state: 'running' | 'completed' | 'cancelled' | 'failed', turnId = 'turn-1'): DirectSessionObservationV1 => ({ v: 1, state, turnId, source: 'desktop' });
const rolloutFact = (observation: DirectSessionObservationV1): DirectSessionObservationV1 => observation.state === 'unknown' ? observation : { ...observation, source: 'rollout' };
const rolloutItems = (observations: DirectSessionObservationV1[]) => observations.map((observation, index) => ({ id: `fact-${index}`, createdAtMs: index,
  raw: { role: 'agent', directSessionObservationV1: rolloutFact(observation) } }));

/** 以模拟提供方事件驱动完整关注链；持久化和 Expo 均由外部边界观测。 */
async function follow() {
  let listener: DirectSessionTranscriptUpdateListener = () => {};
  let initialCursor: string | undefined;
  const lease = await createManagedDirectSessionFollowLease({
    sessionId: 'linked', reason: 'background_follow', shouldProcessBackgroundFollowEffects: () => true,
    notificationContext: { credentials, accountId: 'account', machineId: 'machine', linkedMetadata: JSON.parse(boundary.wire),
      expoPushSender: new PushNotificationClient(credentials.token, 'https://api.example.test') },
    acquireProviderFollowLease: async (cursor) => {
      initialCursor = cursor;
      return { release() {}, subscribeToTranscriptUpdates(next) { listener = next; return () => {}; } };
    },
  });
  return { lease, initialCursor,
    updateRaw: (update: Parameters<DirectSessionTranscriptUpdateListener>[0]) => listener(update),
    update: (observations: DirectSessionObservationV1[], items: any[] = [], continuity: 'snapshot' | 'event' = 'snapshot') => listener({ items, observations: observations.map((observation) => ({ observation, continuity })), truncated: false }),
    updateWithCursor: (observations: DirectSessionObservationV1[], fromCursor: string, nextCursor: string) => listener({ items: rolloutItems(observations), fromCursor, nextCursor,
      observations: observations.map((observation) => ({ observation: rolloutFact(observation), continuity: 'event' as const })), truncated: false }),
  };
}

describe('Direct follow notification owner through persistence and Expo boundaries', () => {
  beforeEach(() => {
    boundary.wire = JSON.stringify(metadata()); boundary.version = 1; boundary.beforeAck = undefined; boundary.rejectMetadata = undefined; boundary.beforeWrite = undefined; boundary.dropNextAck = false;
    boundary.send.mockReset().mockImplementation(async (messages: unknown[]) => messages.map((_, index) => ({ status: 'ok', id: `ticket-${index}` })));
    vi.mocked(axios.get).mockReset().mockImplementation(async (url) => {
      if (String(url).includes('/v2/sessions/')) return { status: 200, data: { session: rawSession() } };
      if (String(url).endsWith('/push-tokens')) return { data: { tokens: [{ id: 'device', token: 'ExponentPushToken[synthetic]' }] } };
      return { data: { badgeCount: 0 } };
    });
    vi.mocked(axios.patch).mockReset().mockImplementation(async (_url, payload: any) => {
      if (payload.metadata.expectedVersion !== boundary.version) return { status: 200, data: { success: false, error: 'version-mismatch', metadata: { version: boundary.version, value: boundary.wire } } };
      boundary.wire = payload.metadata.ciphertext; boundary.version++;
      return { status: 200, data: { success: true, metadata: { version: boundary.version } } };
    });
    setActiveAccountSettingsSnapshot({ source: 'network', settings: accountSettingsParse({}), settingsVersion: 1,
      loadedAtMs: 1, settingsSecretsReadKeys: [], scopeKey: resolveAccountSettingsScopeKey(credentials) });
  });
  afterEach(() => { resetActiveAccountSettingsSnapshotForTests(); vi.unstubAllEnvs(); });

  it('replaces notification generation on enable-disable-enable while the same viewer remains attached', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hfollow-toggle-'));
    await mkdir(join(root, 'sessions'));
    const remoteSessionId = '33333333-3333-3333-3333-333333333333';
    const path = join(root, 'sessions', `rollout-2026-09-23-${remoteSessionId}.jsonl`);
    await writeFile(path, `${JSON.stringify({ type: 'session_meta', payload: { id: remoteSessionId } })}\n`);
    const saved = metadata();
    const source = { kind: 'codexHome' as const, home: 'user' as const, homePath: root };
    saved.directSessionV1.source = source;
    saved.directSessionV1.remoteSessionId = remoteSessionId;
    boundary.wire = JSON.stringify(saved);
    vi.stubEnv('HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS', '100');
    const handlers = new Map<string, (value: unknown) => Promise<unknown>>();
    const lifecycle = registerMachineDirectSessionsRpcHandlers({
      rpcHandlerManager: { registerHandler(method, handler) { handlers.set(method, async (value) => handler(value as never)); } },
      getDaemonIdentity: async () => ({ accountId: 'account', machineId: 'machine' }),
      notifications: { credentials, expoPushSender: new PushNotificationClient(credentials.token) },
    });
    const request = { machineId: 'machine', sessionId: 'linked', providerId: 'codex', remoteSessionId, source };
    const invoke = (method: string, extra: Record<string, unknown> = {}) => handlers.get(method)!({ ...request, ...extra });
    const appendTurn = async (turnId: string) => appendFile(path, ['task_started', 'task_complete'].map((type) =>
      JSON.stringify({ type: 'event_msg', timestamp: '2026-09-23T00:00:01Z', payload: { type, turn_id: turnId } })).join('\n') + '\n');
    try {
      await lifecycle.reconcile('linked');
      await expect(invoke(RPC_METHODS.DAEMON_DIRECT_SESSION_ATTACH, { leaseId: 'same-viewer', ttlMs: 45_000 })).resolves.toMatchObject({ ok: true });
      await appendTurn('generation-one');
      await vi.waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(1));
      await expect(invoke(RPC_METHODS.DAEMON_DIRECT_SESSION_FOLLOW_POLICY_SET, { enabled: false })).resolves.toMatchObject({ ok: true, enabled: false });
      await appendTurn('while-disabled');
      await vi.waitFor(async () => {
        const result = await invoke(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET) as { observation?: DirectSessionObservationV1 };
        expect(result.observation).toEqual({ v: 1, source: 'rollout', state: 'completed', turnId: 'while-disabled' });
      });
      expect(boundary.send).toHaveBeenCalledTimes(1);
      await expect(invoke(RPC_METHODS.DAEMON_DIRECT_SESSION_FOLLOW_POLICY_SET, { enabled: true })).resolves.toMatchObject({ ok: true, enabled: true });
      const generation = JSON.parse(boundary.wire).directSessionV1.followPolicyV1.generation;
      expect(generation).not.toBe('follow-1');
      await expect(invoke(RPC_METHODS.DAEMON_DIRECT_SESSION_ATTACH, { leaseId: 'same-viewer', ttlMs: 45_000 }))
        .resolves.toMatchObject({ ok: true, leaseId: 'same-viewer', renewed: true });
      await appendTurn('generation-two');
      await vi.waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(2));
      const state = JSON.parse(boundary.wire).directSessionV1.notificationStateV1;
      expect(state.generation).toBe(generation);
      expect(state.lastKnown).toMatchObject({ state: 'completed', turnId: 'generation-two' });
    } finally {
      await lifecycle.dispose();
      // 已开始的只读索引写入可能晚于 lease 释放结束；只对测试临时目录重试清理。
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
    }
  });

  it('restores a persisted follow from paginated inactive sessions and resumes an in-flight rollout after daemon disposal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hfollow-'));
    await mkdir(join(root, 'sessions'));
    const remoteId = '11111111-1111-1111-1111-111111111111';
    const path = join(root, 'sessions', `rollout-2026-09-23-${remoteId}.jsonl`);
    await writeFile(path, `${JSON.stringify({ type: 'session_meta', payload: { id: remoteId } })}\n`);
    const saved = metadata();
    saved.directSessionV1.source = { kind: 'codexHome', home: 'user', homePath: root } as typeof saved.directSessionV1.source;
    saved.directSessionV1.remoteSessionId = remoteId;
    boundary.wire = JSON.stringify(saved);
    const pageRequests: unknown[] = [];
    const originalGet = vi.mocked(axios.get).getMockImplementation()!;
    vi.mocked(axios.get).mockImplementation(async (url, config) => {
      if (String(url).endsWith('/v2/sessions')) {
        pageRequests.push(config?.params);
        return { status: 200, data: config?.params?.cursor ? { sessions: [rawSession()], nextCursor: null, hasNext: false }
          : { sessions: [], nextCursor: 'page-2', hasNext: true } };
      }
      return originalGet(url, config);
    });
    const register = () => registerMachineDirectSessionsRpcHandlers({
      rpcHandlerManager: { registerHandler() {} }, getDaemonIdentity: async () => ({ accountId: 'account', machineId: 'machine' }),
      notifications: { credentials, expoPushSender: new PushNotificationClient(credentials.token) },
    });
    let lifecycle = register();
    try {
      await lifecycle.reconcile();
      await appendFile(path, `${JSON.stringify({ type: 'event_msg', timestamp: '2026-09-23T00:00:01Z', payload: { type: 'task_started', turn_id: 'recover-turn' } })}\n`);
      await vi.waitFor(() => expect(JSON.parse(boundary.wire).directSessionV1.notificationStateV1?.lastKnown)
        .toMatchObject({ state: 'running', turnId: 'recover-turn' }));
      await lifecycle.dispose();
      await appendFile(path, `${JSON.stringify({ type: 'event_msg', timestamp: '2026-09-23T00:00:02Z', payload: { type: 'task_complete', turn_id: 'recover-turn' } })}\n`);
      lifecycle = register();
      await lifecycle.reconcile();
      await vi.waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(1));
      expect(pageRequests).toContainEqual({ cursor: 'page-2' });
      expect(pageRequests.some((params: any) => params.activeOnly === true)).toBe(false);
    } finally { await lifecycle?.dispose(); await rm(root, { recursive: true, force: true }); }
  });

  it('recovers a failed cursor CAS on the same live rollout lease and handles the next turn without repeating an unknown submission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hfollow-live-retry-'));
    await mkdir(join(root, 'sessions'));
    const remoteId = '22222222-2222-2222-2222-222222222222';
    const path = join(root, 'sessions', `rollout-2026-09-23-${remoteId}.jsonl`);
    await writeFile(path, `${JSON.stringify({ type: 'session_meta', payload: { id: remoteId } })}\n`);
    const saved = metadata();
    saved.directSessionV1.source = { kind: 'codexHome', home: 'user', homePath: root } as typeof saved.directSessionV1.source;
    saved.directSessionV1.remoteSessionId = remoteId;
    boundary.wire = JSON.stringify(saved);
    const originalGet = vi.mocked(axios.get).getMockImplementation()!;
    vi.mocked(axios.get).mockImplementation(async (url, config) => String(url).endsWith('/v2/sessions')
      ? { status: 200, data: { sessions: [rawSession()], nextCursor: null, hasNext: false } } : originalGet(url, config));
    const lifecycle = registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager: { registerHandler() {} },
      getDaemonIdentity: async () => ({ accountId: 'account', machineId: 'machine' }),
      notifications: { credentials, expoPushSender: new PushNotificationClient(credentials.token) } });
    const appendTurn = async (type: 'task_started' | 'task_complete', turnId: string) => appendFile(path,
      `${JSON.stringify({ type: 'event_msg', timestamp: '2026-09-23T00:00:01Z', payload: { type, turn_id: turnId } })}\n`);
    try {
      await lifecycle.reconcile();
      await appendTurn('task_started', 'turn-a');
      await vi.waitFor(() => expect(JSON.parse(boundary.wire).directSessionV1.notificationStateV1?.lastKnown)
        .toMatchObject({ state: 'running', turnId: 'turn-a' }));
      await vi.waitFor(() => expect(JSON.parse(boundary.wire).directSessionV1.notificationStateV1?.cursor).toEqual(expect.any(String)));
      const cursorBefore = JSON.parse(boundary.wire).directSessionV1.notificationStateV1.cursor;
      let failed = false;
      boundary.rejectMetadata = (wire) => {
        const state = JSON.parse(wire).directSessionV1.notificationStateV1;
        if (!failed && state?.lastKnown?.state === 'completed' && state.cursor !== cursorBefore) { failed = true; return true; }
        return false;
      };
      boundary.send.mockRejectedValueOnce(new Error('Expo response lost'));
      await appendTurn('task_complete', 'turn-a');
      await vi.waitFor(() => expect(failed).toBe(true));
      await vi.waitFor(() => expect(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.cursor).not.toBe(cursorBefore), { timeout: 2500 });
      expect(boundary.send).toHaveBeenCalledTimes(1);
      await appendTurn('task_started', 'turn-b');
      await appendTurn('task_complete', 'turn-b');
      await vi.waitFor(() => expect(boundary.send).toHaveBeenCalledTimes(2));
      expect(boundary.send.mock.calls.map(([messages]) => messages[0].data.turnId)).toEqual(['turn-a', 'turn-b']);
    } finally { await lifecycle.dispose(); await rm(root, { recursive: true, force: true }); }
  });

  it('does not notify from an initial historical completion, assistant text, or cancellation', async () => {
    const owner = await follow();
    await owner.update([fact('completed', 'old')]);
    await owner.update([], [{ id: 'text', createdAtMs: 10, raw: { role: 'agent', content: { type: 'text', text: 'done' } } }]);
    expect(JSON.parse(boundary.wire).directSessionAttentionV1).toMatchObject({ observedProgressToken: '10:text' });
    await owner.update([fact('running'), fact('cancelled')]);
    expect(boundary.send).not.toHaveBeenCalled();
    await owner.lease?.release();
  });

  it('retries initial snapshot persistence without turning historical completion into a notification', async () => {
    let failed = false;
    boundary.rejectMetadata = () => { if (!failed) { failed = true; return true; } return false; };
    const readAfterTranscript = vi.fn().mockResolvedValueOnce({ items: [], nextCursor: 'initial-tail', truncated: false,
      observations: [{ observation: fact('completed', 'historical-turn'), continuity: 'snapshot' as const }] })
      .mockResolvedValue({ items: [], nextCursor: 'initial-tail', truncated: false });
    const lease = await createManagedDirectSessionFollowLease({ sessionId: 'linked', reason: 'background_follow', shouldProcessBackgroundFollowEffects: () => true,
      notificationContext: { credentials, accountId: 'account', machineId: 'machine', linkedMetadata: JSON.parse(boundary.wire),
        expoPushSender: new PushNotificationClient(credentials.token) },
      acquireProviderFollowLease: () => createPollingDirectSessionFollowLease({ readAfterTranscript, env: { HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS: '10' } }),
    });
    try {
      await vi.waitFor(() => expect(JSON.parse(boundary.wire).directSessionV1.notificationStateV1?.cursor).toBe('initial-tail'));
      expect(failed).toBe(true);
      expect(boundary.send).not.toHaveBeenCalled();
      expect(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.lastKnown).toMatchObject({ turnId: 'historical-turn', state: 'completed' });
    } finally { await lease?.release(); }
  });

  it('replays a batch to the successful managed listener without resubmitting when another listener fails', async () => {
    let resolveRead!: (result: { items: ReturnType<typeof rolloutItems>; nextCursor: string; truncated: boolean }) => void;
    const readAfterTranscript = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }))
      .mockResolvedValue({ items: [], nextCursor: 'cursor-1', truncated: false });
    const provider = await createPollingDirectSessionFollowLease({ readAfterTranscript, initialCursor: 'cursor-0', env: { HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS: '10' } });
    const lease = await createManagedDirectSessionFollowLease({ sessionId: 'linked', reason: 'background_follow', shouldProcessBackgroundFollowEffects: () => true,
      notificationContext: { credentials, accountId: 'account', machineId: 'machine', linkedMetadata: JSON.parse(boundary.wire),
        expoPushSender: new PushNotificationClient(credentials.token) }, acquireProviderFollowLease: async () => provider });
    const observer = vi.fn().mockRejectedValueOnce(new Error('another listener unavailable')).mockResolvedValue(undefined);
    provider.subscribeToTranscriptUpdates?.(observer);
    try {
      resolveRead({ items: rolloutItems([fact('completed', 'observed-turn')]), nextCursor: 'cursor-1', truncated: false });
      await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(provider.getTailCursor?.()).toBe('cursor-1'));
      expect(observer.mock.calls[1][0]).toEqual(observer.mock.calls[0][0]);
      expect(boundary.send).toHaveBeenCalledTimes(1);
    } finally { await lease?.release(); }
  });

  it.each(['disabled', 'generation_changed'] as const)('acknowledges a retry as obsolete after explicit %s instead of retrying metadata effects', async (variant) => {
    const owner = await follow();
    await owner.updateWithCursor([fact('running')], 'tail', 'cursor-0');
    boundary.rejectMetadata = () => true;
    await expect(owner.updateWithCursor([fact('completed')], 'cursor-0', 'cursor-1')).rejects.toThrow('Metadata update failed');
    const changed = JSON.parse(boundary.wire);
    if (variant === 'disabled') changed.directSessionV1.followPolicyV1.policy = 'attached_only';
    else changed.directSessionV1.followPolicyV1.generation = 'new-generation';
    boundary.wire = JSON.stringify(changed); boundary.version++;
    const metadataWrite = vi.fn(() => true);
    boundary.rejectMetadata = metadataWrite;
    await expect(owner.updateWithCursor([fact('completed')], 'cursor-0', 'cursor-1')).resolves.toBeUndefined();
    expect(metadataWrite).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
    await owner.lease?.release();
  });

  it('notifies a short new turn whose first observed fact is a continuous completion, but never replays a reconnect snapshot', async () => {
    const owner = await follow();
    await owner.update([fact('completed', 'history')]);
    await owner.update([fact('completed', 'fast-turn')], [], 'event');
    expect(boundary.send).toHaveBeenCalledTimes(1);
    await owner.update([{ v: 1, state: 'unknown', reason: 'connection_closed' }]);
    await owner.update([fact('completed', 'offline-history')]);
    expect(boundary.send).toHaveBeenCalledTimes(1);
    await owner.update([fact('failed', 'fast-failure')], [], 'event');
    expect(boundary.send).toHaveBeenCalledTimes(2);
    expect(boundary.send.mock.calls[1][0][0].data.topic).toBe('session_failed');
    await owner.lease?.release();
  });

  it('notifies an explicit post-cursor terminal event without requiring a prior running snapshot', async () => {
    const owner = await follow();
    await owner.update([fact('completed', 'after-tail')], [], 'event');
    expect(boundary.send).toHaveBeenCalledTimes(1);
    await owner.lease?.release();
  });

  it('claims explicit completion before Expo submission and suppresses duplicates across restored leases', async () => {
    const first = await follow();
    await first.update([fact('running')]);
    await first.lease?.release();
    const restored = await follow();
    boundary.send.mockImplementation(async () => {
      const saved = JSON.parse(boundary.wire).directSessionV1.notificationStateV1;
      expect(Object.values(saved.claims)).toEqual([expect.objectContaining({ status: 'unknown' })]);
      return [{ status: 'ok', id: 'accepted' }];
    });
    await restored.update([fact('completed')]);
    await restored.update([fact('completed')]);
    await restored.lease?.release();
    const again = await follow();
    await again.update([fact('completed')]);
    expect(boundary.send).toHaveBeenCalledTimes(1);
    expect(boundary.send.mock.calls[0][0][0].data).toMatchObject({ sessionId: 'linked', turnId: 'turn-1', interaction: 'open_only', accountId: 'account', notificationIdentity: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await again.lease?.release();
  });

  it('allows only one CAS winner when separate leases observe the same turn', async () => {
    const a = await follow(); const b = await follow();
    await a.update([fact('running')]);
    await Promise.all([a.update([fact('completed')]), b.update([fact('completed')])]);
    expect(boundary.send).toHaveBeenCalledTimes(1);
    await a.lease?.release(); await b.lease?.release();
  });

  it('submits the completion discovered only after CAS retries against a concurrent running checkpoint', async () => {
    const completion = await follow(); const running = await follow();
    boundary.beforeWrite = async () => { await running.update([fact('running')]); };
    await completion.update([fact('completed')]);
    expect(boundary.send).toHaveBeenCalledTimes(1);
    expect(Object.values(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.claims))
      .toEqual([expect.objectContaining({ status: 'submitted' })]);
    await completion.lease?.release(); await running.lease?.release();
  });

  it('submits its own committed claim after a lost socket ACK is recovered through HTTP CAS', async () => {
    vi.stubEnv('HAPPIER_SESSION_SOCKET_ACK_TIMEOUT_MS', '20');
    const owner = await follow();
    await owner.update([fact('running')]);
    boundary.dropNextAck = true;
    await owner.update([fact('completed')]);
    expect(axios.patch).toHaveBeenCalledTimes(1);
    expect(boundary.send).toHaveBeenCalledTimes(1);
    expect(Object.values(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.claims))
      .toEqual([expect.objectContaining({ status: 'submitted' })]);
    await owner.lease?.release();
  });

  it('does not replay unknown submissions after restart', async () => {
    boundary.send.mockRejectedValueOnce(new Error('dropped response'));
    const a = await follow(); await a.update([fact('running'), fact('completed')]); await a.lease?.release();
    const b = await follow(); await b.update([fact('completed')]);
    expect(boundary.send).toHaveBeenCalledTimes(1);
    expect(Object.values(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.claims))
      .toEqual([expect.objectContaining({ status: 'unknown' })]);
    await b.lease?.release();
  });

  it.each(['submitted', 'unknown'] as const)('does not replay an earlier %s claim after a multi-turn batch fails to commit its cursor', async (status) => {
    const a = await follow();
    await a.updateWithCursor([fact('running', 'turn-a')], 'tail', 'before-batch');
    if (status === 'unknown') boundary.send.mockRejectedValueOnce(new Error('response lost after Expo submission'));
    const batch = [fact('completed', 'turn-a'), fact('running', 'turn-b'), fact('completed', 'turn-b')];
    boundary.rejectMetadata = (wire) => JSON.parse(wire).directSessionV1.notificationStateV1?.cursor === 'after-batch';
    await expect(a.updateWithCursor(batch, 'before-batch', 'after-batch')).rejects.toThrow('Metadata update failed');
    expect(boundary.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.cursor).toBe('before-batch');
    expect(Object.values(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.claims)).toEqual(expect.arrayContaining([
      expect.objectContaining({ turnId: 'turn-a', status }), expect.objectContaining({ turnId: 'turn-b', status: 'submitted' }),
    ]));
    await a.lease?.release();
    boundary.rejectMetadata = undefined;
    const restored = await follow();
    expect(restored.initialCursor).toBe('before-batch');
    await restored.updateWithCursor(batch, 'before-batch', 'after-batch');
    expect(boundary.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.cursor).toBe('after-batch');
    expect(Object.values(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.claims))
      .toEqual([expect.objectContaining({ turnId: 'turn-b' })]);
    await restored.lease?.release();
  });

  it('compacts prior turns only with a committed read boundary instead of accumulating completed history', async () => {
    const owner = await follow();
    for (let i = 0; i < 8; i++) {
      await owner.updateWithCursor([fact('completed', `turn-${i}`)], i === 0 ? 'tail' : `cursor-${i - 1}`, `cursor-${i}`);
      expect(Object.values(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.claims))
        .toEqual([expect.objectContaining({ turnId: `turn-${i}`, status: 'submitted' })]);
    }
    expect(boundary.send).toHaveBeenCalledTimes(8);
    await owner.lease?.release();
  });

  it('rejects an obsolete reader batch after another lease commits beyond its claims', async () => {
    const seed = await follow();
    await seed.updateWithCursor([fact('running', 'turn-a')], 'tail', 'before-batch');
    await seed.lease?.release();
    const current = await follow(); const stale = await follow();
    await current.updateWithCursor([fact('completed', 'turn-a'), fact('completed', 'turn-b')], 'before-batch', 'after-batch');
    await stale.updateWithCursor([fact('completed', 'turn-a')], 'before-batch', 'middle-batch');
    expect(boundary.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.cursor).toBe('after-batch');
    await current.lease?.release(); await stale.lease?.release();
  });

  it('retains an unknown Desktop claim until the committed rollout cursor actually covers that turn terminal', async () => {
    const desktop = await follow();
    await desktop.updateWithCursor([fact('running', 'turn-a')], 'tail', 'cursor-0');
    boundary.send.mockRejectedValueOnce(new Error('Expo response lost'));
    await desktop.updateRaw({ items: rolloutItems([fact('running', 'turn-a')]), fromCursor: 'cursor-0', nextCursor: 'cursor-1', truncated: false,
      observations: [fact('completed', 'turn-a'), fact('running', 'turn-b')].map((observation) => ({ observation, continuity: 'event' })) });
    await desktop.lease?.release();
    const fallback = await follow();
    expect(fallback.initialCursor).toBe('cursor-1');
    await fallback.updateWithCursor([fact('completed', 'turn-a')], 'cursor-1', 'cursor-2');
    expect(boundary.send).toHaveBeenCalledTimes(1);
    expect(Object.values(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.claims))
      .toEqual([expect.objectContaining({ turnId: 'turn-a', status: 'unknown' })]);
    await fallback.updateWithCursor([fact('running', 'turn-b')], 'cursor-2', 'cursor-3');
    expect(Object.keys(JSON.parse(boundary.wire).directSessionV1.notificationStateV1.claims)).toHaveLength(0);
    await fallback.lease?.release();
  });

  it('claims each native request identity once and sends only an open action to the linked task', async () => {
    const owner = await follow();
    await owner.update([fact('running')]);
    const request = (requestId: string): DirectSessionObservationV1 => ({ v: 1, source: 'desktop', turnId: 'turn-1', state: 'needs_input',
      requests: [{ requestId, kind: 'permission_request' }] });
    await owner.update([request('approval-1'), request('approval-1'), request('approval-2')], [], 'event');
    expect(boundary.send).toHaveBeenCalledTimes(2);
    const messages = boundary.send.mock.calls.map(([messages]) => messages[0]);
    expect(messages.map((message) => message.data.requestId)).toEqual(['approval-1', 'approval-2']);
    for (const message of messages) {
      expect(message.data).toMatchObject({ sessionId: 'linked', machineId: 'machine', turnId: 'turn-1', interaction: 'open_only',
        serverUrl: 'https://api.example.test' });
      expect(message.categoryId).toBeUndefined();
    }
    await owner.lease?.release();
    const restored = await follow();
    await restored.update([request('approval-2')]);
    expect(boundary.send).toHaveBeenCalledTimes(2);
    await restored.lease?.release();
  });

  it.each(['disabled', 'source_changed', 'generation_changed', 'deleted'])('invalidates %s between claim and submission', async (variant) => {
    const a = await follow(); await a.update([fact('running')]);
    boundary.beforeAck = () => {
      boundary.beforeAck = undefined;
      const saved = JSON.parse(boundary.wire);
      if (variant === 'disabled') saved.directSessionV1.followPolicyV1.policy = 'attached_only';
      if (variant === 'source_changed') saved.directSessionV1.remoteSessionId = 'another-thread';
      if (variant === 'generation_changed') saved.directSessionV1.followPolicyV1.generation = 'follow-2';
      if (variant === 'deleted') vi.mocked(axios.get).mockResolvedValue({ status: 404, data: {} });
      boundary.wire = JSON.stringify(saved); boundary.version++;
    };
    await a.update([fact('completed')]);
    expect(boundary.send).not.toHaveBeenCalled();
    await a.lease?.release();
  });
});
