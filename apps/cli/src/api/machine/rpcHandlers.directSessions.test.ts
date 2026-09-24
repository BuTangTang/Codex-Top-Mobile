import { appendFile, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createServer as createSocketServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { writeFakeCodexAppServerThreadListScript } from '@/backends/codex/appServer/testkit/fakeCodexAppServer';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/rpc/handlers/registerSessionHandlers';
import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { configuration } from '@/configuration';
import { ensureDirectSessionLink } from '@/api/directSessions/linking/ensureDirectSessionLink';
import type { Credentials } from '@/persistence';
import type { DirectSessionsSource } from '@happier-dev/protocol';
import axios from 'axios';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { authorizeMachineRpcRequest } from '@/api/machine/machineRpcAuthorization';
import { decodeBase64, decrypt, encodeBase64, encrypt } from '@/api/encryption';

const readCredentialsMock = vi.fn();
const readSettingsMock = vi.fn();
const fetchSessionByIdMock = vi.fn();
const fetchSessionsPageMock = vi.fn();
const getOrCreateSessionByTagMock = vi.fn();
const commitSessionStoredMessageMock = vi.fn();
const updateSessionMetadataWithRetryMock = vi.fn();

// 配置边界使用独立日志目录，避免真实 Logger 的保留策略清理无关 /tmp 日志。
vi.mock('@/configuration', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return {
    configuration: {
      apiServerUrl: 'https://relay.invalid',
      activeServerDir: '/tmp/happier-test-active-server',
      happyHomeDir: '/tmp/happier-test-home',
      logsDir: await mkdtemp(join(tmpdir(), 'codextop-rpc-logs-')),
      isDaemonProcess: false,
    },
  };
});
afterAll(() => rm(configuration.logsDir, { recursive: true, force: true }));

vi.mock('@/persistence', () => ({
  readCredentials: (...args: unknown[]) => readCredentialsMock(...args),
  readSettings: (...args: unknown[]) => readSettingsMock(...args),
}));

vi.mock('@/session/transport/http/sessionsHttp', async () => {
  const actual = await vi.importActual<typeof import('@/session/transport/http/sessionsHttp')>('@/session/transport/http/sessionsHttp');
  return {
    ...actual,
    fetchSessionById: (...args: unknown[]) => fetchSessionByIdMock(...args),
    /** 模拟会话列表 HTTP 边界，内部关联查找仍执行真实实现。 */
    fetchSessionsPage: (...args: unknown[]) => fetchSessionsPageMock(...args),
    /** 模拟按标签创建会话的 HTTP 边界，保留真实关联生产者生成的元数据。 */
    getOrCreateSessionByTag: (...args: unknown[]) => getOrCreateSessionByTagMock(...args),
    commitSessionStoredMessage: (...args: unknown[]) => commitSessionStoredMessageMock(...args),
  };
});

vi.mock('@/session/metadata/updateSessionMetadataWithRetry', () => ({
  updateSessionMetadataWithRetry: (...args: unknown[]) => updateSessionMetadataWithRetryMock(...args),
}));

import { registerMachineDirectSessionsRpcHandlers } from './rpcHandlers.directSessions';

function jsonlLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

type DesktopRpcRequest = {
  method: string;
  requestId: string;
  targetClientId?: string;
  params: Record<string, unknown>;
};

/**
 * 用真实 catalog、关联解密、source 校验和 Desktop IPC 跑完整 RPC 路径。
 * 只有 HTTP/凭据、进程回调和临时 Desktop socket 是外部边界，测试不触碰真实会话。
 * 默认提供可开始新轮的 idle 历史；控制/观察场景显式选 active，缺 runtime 用于验证拒绝。
 */
async function withDesktopRpcFixture(
  outcome: 'accepted' | 'unknown' | 'rejected' | 'owner_unavailable',
  run: (fixture: {
    handlers: Map<string, (request: unknown) => Promise<unknown>>;
    requests: DesktopRpcRequest[];
    request: { machineId: string; sessionId: string; text: string; localId: string; meta: Record<string, unknown> };
    source: { kind: 'codexHome'; home: 'user'; homePath: string };
    rawSession: { id: string; metadataVersion: number; encryptionMode: 'plain'; metadata: string };
    spawnSession: ReturnType<typeof vi.fn>;
    stopSession: ReturnType<typeof vi.fn>;
    credentials: Credentials;
    invokeTransport: (method: string, payload: Record<string, unknown>) => Promise<unknown>;
    publishSnapshot: (revision: number, turns: Array<{ turnId: string; status: string }>) => void;
    setOwnerAvailable: (available: boolean) => void;
    lifecycle: ReturnType<typeof registerMachineDirectSessionsRpcHandlers>;
  }) => Promise<void>,
  options: { daemonMachineId?: string; identityAvailable?: boolean; initialRuntime?: 'idle' | 'active' | 'missing' } = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'hdr-'));
  const codexHome = join(root, 'codex');
  await mkdir(join(codexHome, 'ipc'), { recursive: true, mode: 0o700 });
  await mkdir(join(codexHome, 'sessions'), { recursive: true });
  // activity 走真实 rollout mtime，避免这个测试调用旧的 app-server metadata 查询。
  for (const id of ['native-linked-thread', 'different-native-thread']) {
    await writeFile(join(codexHome, 'sessions', `rollout-2026-09-23-${id}.jsonl`), jsonlLine({ type: 'session_meta', payload: { id, cwd: root } }));
  }
  const originalServerDir = Object.getOwnPropertyDescriptor(configuration, 'activeServerDir')!;
  Object.defineProperty(configuration, 'activeServerDir', { ...originalServerDir, value: join(root, 'happier-server') });
  const source = { kind: 'codexHome', home: 'user', homePath: codexHome } as const;
  const rawSession = {
    id: 'linked-happier-session', metadataVersion: 1, encryptionMode: 'plain' as const,
    metadata: '',
  };
  const token = `synthetic.${Buffer.from(JSON.stringify({ sub: 'rpc-account' })).toString('base64url')}.signature`;
  const credentials: Credentials = { token, encryption: { type: 'legacy', secret: new Uint8Array(32) } };
  readCredentialsMock.mockResolvedValue(credentials);
  fetchSessionsPageMock.mockResolvedValue({ sessions: [], hasNext: false, nextCursor: null });
  // 用真实关联生产者构建 runtime descriptor，HTTP 边界仅保存最终元数据。
  getOrCreateSessionByTagMock.mockImplementation(async ({ metadata }: { metadata: Record<string, unknown> }) => {
    rawSession.metadata = JSON.stringify(metadata);
    return { session: rawSession };
  });
  await ensureDirectSessionLink({ credentials, machineId: 'machine-a', providerId: 'codex',
    remoteSessionId: 'native-linked-thread', source, codexBackendMode: 'appServer', directoryHint: root,
    /** 固定关联记录时间，使合成样例不依赖真实时钟。 */
    nowMs: () => 1 });
  fetchSessionByIdMock.mockResolvedValue(rawSession);
  const requests: DesktopRpcRequest[] = [];
  const sockets = new Set<Socket>();
  const followers = new Set<Socket>();
  let ownerAvailable = outcome !== 'owner_unavailable';
  /** 独立编码当前 Desktop 使用的小端长度帧，不复用被测 parser。 */
  const respond = (socket: Socket, value: unknown): void => {
    const body = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    socket.write(Buffer.concat([header, body]));
  };
  // 外部 router 只提供原 owner 的发现与接收回执，不实现任何执行器。
  const router = createSocketServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => { sockets.delete(socket); followers.delete(socket); });
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const size = buffer.readUInt32LE(0);
        // 合成第三方 JSON 传输边界；测试断言会核对请求目标和内容。
        const request = JSON.parse(buffer.subarray(4, size + 4).toString()) as DesktopRpcRequest;
        buffer = buffer.subarray(size + 4);
        requests.push(request);
        if (request.method === 'initialize') {
          respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'rpc-follower', result: { clientId: 'rpc-follower' } });
        } else if (request.method === 'thread-owner-discovery') {
          if (!ownerAvailable) respond(socket, { type: 'response', requestId: request.requestId, resultType: 'error', error: 'no-client-found' });
          else respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'original-desktop-owner', result: { supportsUntrustedAppInput: true } });
        } else if (request.method === 'thread-follower-load-complete-history') {
          // 现有 owner 的关联历史回执固定选中本夹具发布的唯一快照。
          respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'original-desktop-owner', result: { revision: 1 } });
        } else if (request.method === 'thread-follower-start-turn') {
          if (outcome === 'unknown') socket.destroy();
          else if (outcome === 'rejected') respond(socket, { type: 'response', requestId: request.requestId, resultType: 'error', error: 'no-client-found' });
          else respond(socket, { type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'original-desktop-owner', result: { result: { turn: { id: 'accepted-native-turn' } } } });
        } else if (request.method === 'thread-stream-following-changed' && request.params.following === true) {
          followers.add(socket);
          respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'original-desktop-owner',
            params: { hostId: 'local', conversationId: request.params.conversationId, change: { type: 'snapshot', revision: 1,
              conversationState: { id: request.params.conversationId, requests: [],
                ...(options.initialRuntime === 'missing' ? {} : { threadRuntimeStatus: { type: options.initialRuntime ?? 'idle' } }),
                turns: [{ turnId: 'observed-active-turn', status: options.initialRuntime === 'active' ? 'inProgress' : 'completed', items: [] }] } } } });
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => { router.once('error', reject); router.listen(join(codexHome, 'ipc', 'ipc.sock'), resolve); });
  const handlers = new Map<string, (request: unknown) => Promise<unknown>>();
  const spawnSession = vi.fn();
  const stopSession = vi.fn();
  const key = new Uint8Array(32);
  const daemonMachineId = options.daemonMachineId ?? 'machine-a';
  const rpc = new RpcHandlerManager({ scopePrefix: daemonMachineId, encryptionKey: key,
    encryptionVariant: 'legacy', authorizeRequest: authorizeMachineRpcRequest });
  const lifecycle = registerMachineDirectSessionsRpcHandlers({
    rpcHandlerManager: {
      /** 注册完整真实处理链，不绕过 schema、关联目标或 provider。 */
      registerHandler(method, handler) {
        handlers.set(method, async (request) => handler(request as never));
        rpc.registerHandler(method, handler);
      },
    },
    spawnSession,
    stopSession,
    getDaemonIdentity: options.identityAvailable === false ? undefined : async () => ({ machineId: daemonMachineId, accountId: 'rpc-account' }),
  });
  /** 经真实加解密和机器 RPC 授权进入同一 handler，不绕过 method scope。 */
  const invokeTransport = async (method: string, payload: Record<string, unknown>): Promise<unknown> => {
    const response = await rpc.handleRequest({ method: `${daemonMachineId}:${method}`,
      params: encodeBase64(encrypt(key, 'legacy', payload)),
      authorization: { kind: 'session.write', sessionId: String(payload.sessionId) } });
    return decrypt(key, 'legacy', decodeBase64(response));
  };
  try {
    await run({ handlers, requests, rawSession, source, spawnSession, stopSession, credentials, invokeTransport, lifecycle,
      setOwnerAvailable: (available) => { ownerAvailable = available; },
      /** 让发布的观察事件携带与最新轮次一致的原生 runtime，不靠缺字段规避控制门禁。 */
      publishSnapshot: (revision, turns) => {
        for (const socket of followers) respond(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
          sourceClientId: 'original-desktop-owner', params: { hostId: 'local', conversationId: 'native-linked-thread',
            change: { type: 'snapshot', revision, conversationState: { id: 'native-linked-thread', requests: [],
              threadRuntimeStatus: { type: turns.at(-1)?.status === 'inProgress' ? 'active' : 'idle' },
              turns: turns.map((turn) => ({ ...turn, items: [] })) } } } });
      },
      request: { machineId: 'machine-a', sessionId: rawSession.id, text: 'synthetic mobile message', localId: 'mobile-id',
        meta: { sentFrom: 'test', permissionMode: 'default', model: 'tracking-only-model' } } });
    expect(spawnSession).not.toHaveBeenCalled();
    expect(stopSession).not.toHaveBeenCalled();
  } finally {
    await lifecycle.dispose();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => router.close(() => resolve()));
    Object.defineProperty(configuration, 'activeServerDir', originalServerDir);
    readCredentialsMock.mockReset();
    fetchSessionByIdMock.mockReset();
    fetchSessionsPageMock.mockReset();
    getOrCreateSessionByTagMock.mockReset();
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
}

describe('registerMachineDirectSessionsRpcHandlers', () => {
  it('lists genuine projects on the selected machine without offering runner-backed creation', async () => {
    await withDesktopRpcFixture('accepted', async ({ handlers, source, request, spawnSession }) => {
      await writeFile(join(source.homePath, '.codex-global-state.json'), JSON.stringify({
        'local-projects': { 'project-a': { id: 'project-a', name: 'Synthetic project', rootPaths: [source.homePath], createdAt: 1, updatedAt: 1 } },
      }));
      const list = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSIONS_PROJECTS_LIST)!;
      expect(await list({ machineId: request.machineId, providerId: 'codex', source })).toMatchObject({ ok: true,
        projects: [{ id: 'project-a', name: 'Synthetic project', available: true }], nativeCreate: false });
      expect(await list({ machineId: 'unrelated-machine', providerId: 'codex', source })).toMatchObject({ ok: false, error: 'machine_mismatch' });
      expect(spawnSession).not.toHaveBeenCalled();
    });
  });
  it('routes authenticated Desktop control to the original linked task and rejects stale decisions', async () => {
    await withDesktopRpcFixture('accepted', async ({ invokeTransport, request, spawnSession, stopSession }) => {
      const target = { machineId: request.machineId, sessionId: request.sessionId };
      expect(await invokeTransport(RPC_METHODS.DAEMON_DIRECT_SESSION_CONTROL_READ, target)).toMatchObject({ ok: true,
        snapshot: { v: 1, turnId: 'observed-active-turn', state: 'running', textSendMode: 'steer', requests: [] } });
      expect(await invokeTransport(RPC_METHODS.DAEMON_DIRECT_SESSION_CONTROL_ACTION, { ...target, kind: 'approval',
        operationId: 'approval-1', expectedTurnId: 'old-turn', requestId: '7', revision: 'old', decision: 'deny' }))
        .toEqual({ ok: true, result: { status: 'rejected', reason: 'turn_changed' } });
      expect(spawnSession).not.toHaveBeenCalled();
      expect(stopSession).not.toHaveBeenCalled();
    }, { initialRuntime: 'active' });
  });
  // 真正经过认证、关联和 provider 门禁，缺 runtime 不能仅凭历史终态投递。
  it('rejects a Desktop control snapshot and text send without a native runtime status', async () => {
    await withDesktopRpcFixture('accepted', async ({ invokeTransport, request, requests }) => {
      expect(await invokeTransport(RPC_METHODS.DAEMON_DIRECT_SESSION_CONTROL_READ,
        { machineId: request.machineId, sessionId: request.sessionId })).toMatchObject({ ok: false });
      expect(await invokeTransport(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND, request))
        .toMatchObject({ ok: false, errorCode: 'invalid_snapshot' });
      expect(requests.some((entry) => entry.method === 'thread-follower-start-turn')).toBe(false);
    }, { initialRuntime: 'missing' });
  });
  it.each([undefined, { accountId: 'other-account', serverKey: 'https://relay.invalid' },
    { accountId: 'account-a', serverKey: 'https://other.invalid' }])('rejects every product direct entry without a matching source binding: %j', async (binding) => {
    vi.stubEnv('HAPPIER_PRODUCT_MODE', 'codextop');
    readSettingsMock.mockResolvedValue({ passwordAccountBinding: binding });
    readCredentialsMock.mockResolvedValue({ token: `synthetic.${Buffer.from(JSON.stringify({ sub: 'account-a' })).toString('base64url')}.signature` });
    const registered = new Map<string, (request: unknown) => Promise<unknown>>();
    const lifecycle = registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager: {
      /** 保存泛型传输处理器供未认证请求验证；真实注册器负责请求 schema 检查。 */
      registerHandler: (method, handler) => {
        registered.set(method, async (request) => await handler(request as Parameters<typeof handler>[0]));
      },
    } });
    try {
      for (const handler of registered.values()) expect(await handler({})).toMatchObject({ ok: false, error: 'source_account_mismatch' });
      expect(fetchSessionByIdMock).not.toHaveBeenCalled();
    } finally { await lifecycle.dispose(); }
  });
  it('preserves Codex history availability through the catalog and transcript RPC responses', async () => {
    await withDesktopRpcFixture('accepted', async ({ handlers, source }) => {
      const request = { machineId: 'machine-a', providerId: 'codex', remoteSessionId: 'native-linked-thread', source };
      await expect(handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TRANSCRIPT_PAGE)!({ ...request, direction: 'older' }))
        .resolves.toMatchObject({ ok: true, historyAvailability: 'available' });
      await expect(handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TRANSCRIPT_READ_AFTER)!({ ...request, cursor: 'tail' }))
        .resolves.toMatchObject({ ok: true, historyAvailability: 'available' });
    });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  // 发送入口只能使用当前账号关联的会话，拒绝时不能停止或启动任何执行器。
  it.each(['not_authenticated', 'session_not_found', 'machine_mismatch'] as const)(
    'rejects external-owner sends with %s without changing session ownership',
    async (failure) => {
      readCredentialsMock.mockResolvedValueOnce(failure === 'not_authenticated' ? null : {
        token: 'token-direct',
        encryption: { type: 'legacy', secret: new Uint8Array([1, 2, 3]) },
      });
      if (failure !== 'not_authenticated') fetchSessionByIdMock.mockResolvedValueOnce(failure === 'session_not_found' ? null : {
        id: 'linked-session-a',
        metadataVersion: 1,
        encryptionMode: 'plain',
        metadata: JSON.stringify({
          directSessionV1: {
            v: 1,
            providerId: 'codex',
            machineId: 'another-machine',
            remoteSessionId: 'native-thread-a',
            source: { kind: 'codexHome', home: 'user' },
            linkedAtMs: 1,
          },
        }),
      });
      const spawnSession = vi.fn();
      const stopSession = vi.fn();
      const registered = new Map<string, (request: unknown) => Promise<unknown>>();
      registerMachineDirectSessionsRpcHandlers({
        rpcHandlerManager: {
          /** 复用真实注册器边界，不替换内部鉴权和关联会话解析逻辑。 */
          registerHandler(method, handler) {
            registered.set(method, async (request) => handler(request as never));
          },
        },
        spawnSession,
        stopSession,
      });
      const send = registered.get('daemon.directSessions.send');
      expect(send).toBeDefined();
      const response = await send!({
        machineId: 'machine-a',
        sessionId: 'linked-session-a',
        text: 'Continue the synthetic test',
        localId: 'message-a',
        meta: {},
      });
      expect(response).toMatchObject({ ok: false, error: failure });
      expect(spawnSession).not.toHaveBeenCalled();
      expect(stopSession).not.toHaveBeenCalled();
      if (failure === 'not_authenticated') expect(fetchSessionByIdMock).not.toHaveBeenCalled();
    },
  );

  // Unix socket 集成仅在支持的平台运行；Windows 的明确拒绝由底层独立测试覆盖。
  describe.skipIf(process.platform === 'win32')('external Desktop owner transport', () => {
    // 请求正文和关联一起声明另一机器也不能越过实际接收 daemon 的身份边界。
    it.each(['foreign', 'unverified', 'replacement'] as const)('binds external sends and capability to the receiving daemon: %s', async (scenario) => {
      await withDesktopRpcFixture('accepted', async ({ request, source, requests, invokeTransport }) => {
        // 唯一替身为账户机器列表的 HTTP 边界，规范替换链与授权判断仍用真实实现。
        const http = vi.spyOn(axios, 'get').mockResolvedValue({ data: scenario === 'replacement'
          ? [{ id: 'machine-a', replacedByMachineId: 'daemon-other' }, { id: 'daemon-other' }]
          : [{ id: 'machine-a' }, { id: 'daemon-other' }] });
        try {
          const status = await invokeTransport(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET, {
            machineId: request.machineId, sessionId: request.sessionId, providerId: 'codex', source,
            remoteSessionId: 'native-linked-thread',
          });
          const result = await invokeTransport(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND, request);
          if (scenario === 'replacement') {
            expect(status).toMatchObject({ externalControl: { canSend: true } });
            expect(result).toEqual({ ok: true });
            expect(requests.filter((entry) => entry.method === 'thread-follower-start-turn')).toHaveLength(1);
          } else {
            expect.soft(status).not.toMatchObject({ externalControl: { canSend: true } });
            expect.soft(result).toMatchObject({ ok: false, error: 'machine_mismatch' });
            expect.soft(requests).toEqual([]);
          }
        } finally { http.mockRestore(); }
      }, { daemonMachineId: 'daemon-other', identityAvailable: scenario !== 'unverified' });
    });

    // 认证关联与投递意图共享同一次账号快照；await 期间凭据轮换不能污染去重分区。
    it('keeps the authenticated account snapshot when credentials change during submission', async () => {
      await withDesktopRpcFixture('accepted', async ({ request, requests, invokeTransport, credentials }) => {
        const changedToken = `synthetic.${Buffer.from(JSON.stringify({ sub: 'different-account' })).toString('base64url')}.signature`;
        readCredentialsMock.mockReset().mockResolvedValueOnce(credentials)
          .mockResolvedValue({ ...credentials, token: changedToken });
        expect(await invokeTransport(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND, request)).toEqual({ ok: true });
        readCredentialsMock.mockReset().mockResolvedValue(credentials);
        expect(await invokeTransport(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND, request)).toEqual({ ok: true });
        expect(requests.filter((entry) => entry.method === 'thread-follower-start-turn')).toHaveLength(1);
      });
    });

    // 成功必须来自原 Desktop owner 的对应回执；重试相同 ID 不触发第二次执行。
    it('sends through the authenticated linked Desktop owner and deduplicates the native submission', async () => {
      await withDesktopRpcFixture('accepted', async ({ handlers, request, requests }) => {
        const send = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND);
        expect(send).toBeDefined();
        expect(await send!(request)).toEqual({ ok: true });
        expect(await send!(request)).toEqual({ ok: true });
        const starts = requests.filter((entry) => entry.method === 'thread-follower-start-turn');
        expect(starts).toHaveLength(1);
        expect(starts[0]).toMatchObject({ targetClientId: 'original-desktop-owner', params: {
          conversationId: 'native-linked-thread', turnStart: { request: { threadId: 'native-linked-thread', clientUserMessageId: request.localId,
            input: [{ type: 'text', text: request.text, text_elements: [] }] },
            context: { inheritThreadSettings: true } },
        } });
      });
    });

    // 真实探测找不到 owner 时，能力和发送结果都明确拒绝，不创建新的执行器。
    it('reports unavailable Desktop control when the linked owner cannot be discovered', async () => {
      await withDesktopRpcFixture('owner_unavailable', async ({ handlers, request, source, requests }) => {
        const status = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET)!;
        expect(await status({ machineId: request.machineId, sessionId: request.sessionId, providerId: 'codex',
          remoteSessionId: 'native-linked-thread', source }))
          .toMatchObject({ ok: true, runnerActive: false, externalControl: { canSend: false, unavailableReason: 'owner_unavailable' } });
        const send = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND)!;
        expect(await send(request)).toEqual({ ok: false, error: 'owner_unavailable', errorCode: 'owner_unavailable' });
        expect(requests.filter((entry) => entry.method === 'thread-owner-discovery')).toHaveLength(2);
        expect(requests.filter((entry) => entry.method === 'thread-follower-start-turn')).toEqual([]);
      });
    });

    // 未知投递结果保留为 unconfirmed，不能当作拒绝并启动另一个执行器。
    it.each(['unknown', 'rejected'] as const)('preserves Desktop %s delivery without takeover fallback', async (outcome) => {
      await withDesktopRpcFixture(outcome, async ({ handlers, request, requests }) => {
        const send = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND);
        expect(send).toBeDefined();
        const error = outcome === 'unknown' ? 'delivery_outcome_unknown' : 'owner_unavailable';
        expect(await send!(request)).toMatchObject({ ok: false, error, errorCode: error });
        expect(await send!(request)).toMatchObject({ ok: false, error, errorCode: error });
        expect(requests.filter((entry) => entry.method === 'thread-follower-start-turn')).toHaveLength(1);
      });
    });

    // 即便用户可以发送消息，也不能用该入口指定任意原生会话或本机路径。
    it('rejects native target overrides on the external send request before querying a session', async () => {
      await withDesktopRpcFixture('accepted', async ({ handlers, request, requests }) => {
        const send = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND);
        expect(send).toBeDefined();
        expect(await send!({ ...request, remoteSessionId: 'injected-native', source: { kind: 'codexHome', home: 'user', homePath: '/injected' } }))
          .toMatchObject({ ok: false, errorCode: 'invalid_request' });
        expect(fetchSessionByIdMock).not.toHaveBeenCalled();
        expect(requests).toEqual([]);
      });
    });

    // 关联元数据也要经过当前 source 校验，不能因为已存储而绕过 provider 边界。
    it('rejects an invalid source in the linked session before probing or sending', async () => {
      await withDesktopRpcFixture('accepted', async ({ handlers, request, requests, rawSession }) => {
        const metadata = JSON.parse(rawSession.metadata);
        metadata.directSessionV1.source = { kind: 'claudeConfig', configDir: '/invalid-source' };
        rawSession.metadata = JSON.stringify(metadata);
        const send = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND);
        expect(send).toBeDefined();
        expect(await send!(request)).toMatchObject({ ok: false, errorCode: 'invalid_request' });
        expect(requests).toEqual([]);
      });
    });

    // 纯文本能力不能静默丢弃附件、结构化输入或明确的配置覆盖要求。
    it.each([
      { happier: { kind: 'attachments.v1', payload: { attachments: [{ path: 'synthetic.png', kind: 'image' }] } } },
      { happierStructuredInputV1: { v: 1, imageInputs: [{ type: 'image', url: 'https://example.invalid/synthetic.png' }] } },
      { modelOverride: 'explicit-model' },
    ])('rejects unsupported external input metadata before sending', async (meta) => {
      await withDesktopRpcFixture('accepted', async ({ handlers, request, requests }) => {
        const send = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_SEND);
        expect(send).toBeDefined();
        expect(await send!({ ...request, meta })).toMatchObject({ ok: false, error: 'unsupported_input', errorCode: 'unsupported_input' });
        expect(requests.some((entry) => entry.method === 'thread-follower-start-turn')).toBe(false);
      });
    });

    // 外部可发送能力不会冒充 Happier runner，也只能授权认证关联的原生目标。
    it.each(['matching', 'equivalent_path', 'default_home', 'native_mismatch', 'source_mismatch'] as const)('reports external Desktop control only for the matching link: %s', async (linkCase) => {
      await withDesktopRpcFixture('accepted', async ({ handlers, request, source, requests }) => {
        let requestedSource: DirectSessionsSource = { ...source, uiHint: 'irrelevant extension' };
        if (linkCase === 'equivalent_path') requestedSource = { ...source, homePath: `${source.homePath}/../codex/` };
        if (linkCase === 'default_home') {
          vi.stubEnv('CODEX_HOME', source.homePath);
          requestedSource = { kind: 'codexHome', home: 'user' };
        }
        if (linkCase === 'source_mismatch') {
          const otherHome = `${source.homePath}-other`;
          requestedSource = { ...source, homePath: otherHome };
          await mkdir(join(otherHome, 'sessions'), { recursive: true });
          await writeFile(join(otherHome, 'sessions', 'rollout-2026-09-23-native-linked-thread.jsonl'), jsonlLine({ type: 'session_meta' }));
        }
        const status = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET)!;
        const response = await status({ machineId: request.machineId, sessionId: request.sessionId, providerId: 'codex', source: requestedSource,
          remoteSessionId: linkCase === 'native_mismatch' ? 'different-native-thread' : 'native-linked-thread' });
        expect(response).toMatchObject({ ok: true, runnerActive: false });
        if (linkCase === 'matching' || linkCase === 'equivalent_path' || linkCase === 'default_home') {
          expect(response).toMatchObject({ externalControl: { canSend: true },
            observation: { v: 1, state: 'unknown' } });
          expect(requests.filter((entry) => entry.method === 'thread-owner-discovery')).toHaveLength(1);
          expect(requests.some((entry) => entry.method === 'thread-stream-following-changed')).toBe(false);
        } else {
          expect(response).not.toMatchObject({ externalControl: { canSend: true } });
          expect(requests).toEqual([]);
        }
      });
    });

    it.each(['status', 'attach'] as const)('rejects a late %s read after suspension without invalidating the new viewer', async (operation) => {
      await withDesktopRpcFixture('accepted', async ({ handlers, request, source, requests, rawSession, publishSnapshot, lifecycle }) => {
        const target = { machineId: request.machineId, sessionId: request.sessionId, providerId: 'codex',
          remoteSessionId: 'native-linked-thread', source };
        const attach = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_ATTACH)!;
        const status = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET)!;
        const previousSession = { ...rawSession };
        let finishRead!: (value: typeof rawSession) => void;
        const response = new Promise<typeof rawSession>((resolve) => { finishRead = resolve; });
        const entered = new Promise<void>((resolve) => {
          fetchSessionByIdMock.mockImplementationOnce(() => { resolve(); return response; });
        });
        const late = operation === 'status' ? status(target) : attach({ ...target, leaseId: 'old-viewer', ttlMs: 45_000 });
        await entered;
        await lifecycle.suspend();
        const metadata = JSON.parse(rawSession.metadata);
        metadata.directSessionV1.linkedAtMs += 1;
        rawSession.metadata = JSON.stringify(metadata);
        await attach({ ...target, leaseId: 'new-viewer', ttlMs: 45_000 });
        await vi.waitFor(() => expect(requests.some((entry) => entry.method === 'thread-stream-following-changed')).toBe(true));
        publishSnapshot(2, [{ turnId: 'observed-active-turn', status: 'completed' }, { turnId: 'current', status: 'inProgress' }]);
        await vi.waitFor(async () => expect(await status(target)).toMatchObject({ observation: { state: 'running', turnId: 'current' } }));
        finishRead(previousSession);
        await expect(late).resolves.toMatchObject({ ok: false, error: 'source_unavailable' });
        await expect(status(target)).resolves.toMatchObject({ observation: { state: 'running', turnId: 'current' } });
      }, { initialRuntime: 'active' });
    });

    it('reads an un-followed viewer lease, separates sending capability, and invalidates on source change and detach', async () => {
      await withDesktopRpcFixture('accepted', async ({ handlers, request, source, requests, rawSession, publishSnapshot, setOwnerAvailable }) => {
        const target = { machineId: request.machineId, sessionId: request.sessionId, providerId: 'codex',
          remoteSessionId: 'native-linked-thread', source };
        const attach = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_ATTACH)!;
        const status = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET)!;
        const detach = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_DETACH)!;
        await expect(status(target)).resolves.toMatchObject({ observation: { state: 'unknown' }, externalControl: { canSend: true } });
        expect(requests.some((entry) => entry.method === 'thread-stream-following-changed')).toBe(false);
        await expect(attach({ ...target, leaseId: 'viewer-1', ttlMs: 45_000 })).resolves.toMatchObject({ ok: true });
        await vi.waitFor(() => expect(requests.some((entry) => entry.method === 'thread-stream-following-changed')).toBe(true));
        // 新租约的一次关联快照已证明当前运行轮；未关联/未订阅时仍由上方断言保持未知。
        await vi.waitFor(async () => expect(await status(target)).toMatchObject({ observation: { state: 'running', turnId: 'observed-active-turn' } }));
        publishSnapshot(2, [{ turnId: 'observed-active-turn', status: 'completed' }, { turnId: 'current', status: 'inProgress' }]);
        await vi.waitFor(async () => expect(await status(target)).toMatchObject({ observation: { state: 'running', turnId: 'current' }, externalControl: { canSend: true } }));
        setOwnerAvailable(false);
        await expect(status(target)).resolves.toMatchObject({ observation: { state: 'running', turnId: 'current' }, externalControl: { canSend: false } });
        const metadata = JSON.parse(rawSession.metadata);
        metadata.directSessionV1.linkedAtMs += 1;
        rawSession.metadata = JSON.stringify(metadata);
        await expect(status(target)).resolves.toMatchObject({ observation: { state: 'unknown' } });
        await detach({ machineId: target.machineId, sessionId: target.sessionId, leaseId: 'viewer-1' });
        await expect(status(target)).resolves.toMatchObject({ observation: { state: 'unknown' } });
      }, { initialRuntime: 'active' });
    });

  });

  it('takes over a direct claude session using provider cwd and config dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-takeover-'));
    const configDir = join(root, '.claude');
    const sessionFile = join(configDir, 'projects', 'proj-a', 'sess-claude-direct.jsonl');
    await mkdir(join(configDir, 'projects', 'proj-a'), { recursive: true });
    const resolvedConfigDir = await realpath(configDir).catch(() => configDir);
    await writeFile(
      sessionFile,
      [
        jsonlLine({
          type: 'queue-operation',
          operation: 'enqueue',
          sessionId: 'sess-claude-direct',
        }),
        jsonlLine({
          type: 'queue-operation',
          operation: 'dequeue',
          sessionId: 'sess-claude-direct',
        }),
        jsonlLine({
          type: 'user',
          uuid: 'u1',
          cwd: '/tmp/direct-claude-worktree',
          message: { content: 'hello' },
        }),
      ].join(''),
      'utf8',
    );
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', configDir);

    readCredentialsMock.mockResolvedValueOnce({
      token: 'token-direct',
      encryption: { type: 'legacy', secret: new Uint8Array([1, 2, 3]) },
    });
    fetchSessionByIdMock.mockResolvedValueOnce({
      id: 'sess_happy_direct',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        path: '',
        machineId: 'm1',
        flavor: 'claude',
        claudeSessionId: 'sess-claude-direct',
        directSessionV1: {
          v: 1,
          providerId: 'claude',
          machineId: 'm1',
          remoteSessionId: 'sess-claude-direct',
          source: { kind: 'claudeConfig', configDir, projectId: 'proj-a' },
          linkedAtMs: Date.now(),
        },
      }),
    });

    const spawnSession = vi.fn(async (_options: SpawnSessionOptions): Promise<SpawnSessionResult> => ({
      type: 'success',
      sessionId: 'sess_happy_direct',
    }));
    const stopSession = vi.fn(async () => true);
    const registered = new Map<string, (params: unknown) => Promise<unknown>>();
    const rpcHandlerManager: RpcHandlerRegistrar = {
      registerHandler: (method, handler) => {
        // The registrar validates each method-specific handler before this heterogeneous test
        // map erases its key.
        registered.set(method, async (params) => handler(params as never));
      },
    };

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager, spawnSession, stopSession });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      sessionId: 'sess_happy_direct',
    });

    expect(res).toEqual({ ok: true });
    expect(stopSession).not.toHaveBeenCalled();
    expect(spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: '/tmp/direct-claude-worktree',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        existingSessionId: 'sess_happy_direct',
        resume: 'sess-claude-direct',
        approvedNewDirectoryCreation: true,
        transcriptStorage: 'direct',
        environmentVariables: { CLAUDE_CONFIG_DIR: resolvedConfigDir },
      }),
    );
  });

  it('takes over a direct pi session using header cwd and the configured agent dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-takeover-pi-'));
    const agentDir = join(root, '.pi', 'agent');
    const cwd = '/tmp/direct-pi-worktree';
    const sessionsDir = join(agentDir, 'sessions', '--tmp-direct-pi-worktree--');
    await mkdir(sessionsDir, { recursive: true });
    const piSessionId = '019f4a42-4617-767a-8e7c-189b454a0352';
    const sessionFile = join(sessionsDir, `2024-12-03T14-00-00-000Z_${piSessionId}.jsonl`);
    await writeFile(
      sessionFile,
      [
        jsonlLine({ type: 'session', id: piSessionId, timestamp: '2024-12-03T14:00:00.000Z', cwd, version: 3 }),
        jsonlLine({
          type: 'message',
          id: 'm1',
          parentId: null,
          timestamp: '2024-12-03T14:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.parse('2024-12-03T14:00:01.000Z') },
        }),
      ].join(''),
      'utf8',
    );
    const resolvedAgentDir = await realpath(agentDir).catch(() => agentDir);
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);

    readCredentialsMock.mockResolvedValueOnce({
      token: 'token-direct',
      encryption: { type: 'legacy', secret: new Uint8Array([1, 2, 3]) },
    });
    fetchSessionByIdMock.mockResolvedValueOnce({
      id: 'sess_happy_direct_pi',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        path: '/tmp/stale-linked-pi-worktree',
        machineId: 'm1',
        flavor: 'pi',
        piSessionId,
        directSessionV1: {
          v: 1,
          providerId: 'pi',
          machineId: 'm1',
          remoteSessionId: piSessionId,
          source: { kind: 'piAgentDir' },
          linkedAtMs: Date.now(),
        },
      }),
    });

    const spawnSession = vi.fn(async (_options: SpawnSessionOptions): Promise<SpawnSessionResult> => ({
      type: 'success',
      sessionId: 'sess_happy_direct_pi',
    }));
    const stopSession = vi.fn(async () => true);
    const registered = new Map<string, (params: unknown) => Promise<unknown>>();
    const rpcHandlerManager: RpcHandlerRegistrar = {
      registerHandler: (method, handler) => {
        // The registrar validates each method-specific handler before this heterogeneous test
        // map erases its key.
        registered.set(method, async (params) => handler(params as never));
      },
    };

    const markerDir = join('/tmp/happier-test-home', 'tmp', 'daemon-sessions');
    const markerPath = join(markerDir, `pid-${process.pid}.json`);
    await mkdir(markerDir, { recursive: true });
    await writeFile(markerPath, JSON.stringify({
      pid: process.pid,
      happySessionId: 'sess_existing_pi_owner',
      happyHomeDir: '/tmp/happier-test-home',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      flavor: 'pi',
      metadata: { flavor: 'pi', piSessionId },
    }), 'utf8');

    try {
      registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager, spawnSession, stopSession });

      const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER);
      expect(handler).toBeDefined();

      const res = await handler!({
        machineId: 'm1',
        sessionId: 'sess_happy_direct_pi',
        forceStop: true,
      }) as { ok: boolean };

      expect(res).toEqual({ ok: true });
      expect(stopSession).toHaveBeenCalledWith('sess_existing_pi_owner');
      expect(spawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          directory: cwd,
          backendTarget: { kind: 'builtInAgent', agentId: 'pi' },
          existingSessionId: 'sess_happy_direct_pi',
          resume: piSessionId,
          approvedNewDirectoryCreation: true,
          transcriptStorage: 'direct',
          environmentVariables: expect.objectContaining({ PI_CODING_AGENT_DIR: resolvedAgentDir }),
        }),
      );
      expect(stopSession.mock.invocationCallOrder[0]).toBeLessThan(spawnSession.mock.invocationCallOrder[0]);
    } finally {
      await rm(markerPath, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires forceStop before taking over when a trusted local runner still owns the provider session', async () => {
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', '/tmp/claude-direct');
    readCredentialsMock.mockResolvedValueOnce({
      token: 'token-direct',
      encryption: { type: 'legacy', secret: new Uint8Array([1, 2, 3]) },
    });
    fetchSessionByIdMock.mockResolvedValueOnce({
      id: 'sess_happy_direct_force',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        path: '/tmp/direct-claude-worktree',
        machineId: 'm1',
        flavor: 'claude',
        claudeSessionId: 'remote_force_stop',
        directSessionV1: {
          v: 1,
          providerId: 'claude',
          machineId: 'm1',
          remoteSessionId: 'remote_force_stop',
          source: { kind: 'claudeConfig', configDir: '/tmp/claude-direct', projectId: null },
          linkedAtMs: Date.now(),
        },
      }),
    });

    const markerDir = join('/tmp/happier-test-home', 'tmp', 'daemon-sessions');
    const markerPath = join(markerDir, `pid-${process.pid}.json`);
    await mkdir(markerDir, { recursive: true });
    await writeFile(markerPath, JSON.stringify({
      pid: process.pid,
      happySessionId: 'sess_other_runner',
      happyHomeDir: '/tmp/happier-test-home',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      flavor: 'claude',
      metadata: { flavor: 'claude', claudeSessionId: 'remote_force_stop' },
    }), 'utf8');

    const spawnSession = vi.fn(async (_options: SpawnSessionOptions): Promise<SpawnSessionResult> => ({
      type: 'success',
      sessionId: 'sess_happy_direct_force',
    }));
    const stopSession = vi.fn(async () => true);
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    try {
      registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager, spawnSession, stopSession });

      const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER);
      expect(handler).toBeDefined();

      const res = await handler!({
        machineId: 'm1',
        sessionId: 'sess_happy_direct_force',
      });

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe('invalid_request');
      expect(String(res.error)).toContain('force');
      expect(stopSession).not.toHaveBeenCalled();
      expect(spawnSession).not.toHaveBeenCalled();
    } finally {
      await rm(markerPath, { force: true });
    }
  });

  it('converts a direct session to persisted mode by importing transcript, then respawning before flipping persisted metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-persist-'));
    const configDir = join(root, '.claude');
    const sessionFile = join(configDir, 'projects', 'proj-persist', 'sess-claude-persist.jsonl');
    await mkdir(join(configDir, 'projects', 'proj-persist'), { recursive: true });
    await writeFile(
      sessionFile,
      [
        jsonlLine({
          type: 'queue-operation',
          operation: 'enqueue',
          sessionId: 'sess-claude-persist',
        }),
        jsonlLine({
          type: 'queue-operation',
          operation: 'dequeue',
          sessionId: 'sess-claude-persist',
        }),
        jsonlLine({
          type: 'user',
          uuid: 'u1',
          cwd: '/tmp/direct-claude-persist-worktree',
          message: { content: 'hello' },
        }),
        jsonlLine({
          type: 'assistant',
          uuid: 'a1',
          cwd: '/tmp/direct-claude-persist-worktree',
          message: { model: 'm', content: [] },
        }),
      ].join(''),
      'utf8',
    );
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', configDir);

    const metadata = {
      path: '',
      machineId: 'm1',
      flavor: 'claude',
      claudeSessionId: 'sess-claude-persist',
      directSessionV1: {
        v: 1,
        providerId: 'claude',
        machineId: 'm1',
        remoteSessionId: 'sess-claude-persist',
        source: { kind: 'claudeConfig', configDir, projectId: 'proj-persist' },
        linkedAtMs: Date.now(),
      },
    };

    readCredentialsMock.mockResolvedValueOnce({
      token: 'token-direct',
      encryption: { type: 'legacy', secret: new Uint8Array([1, 2, 3]) },
    });
    fetchSessionByIdMock.mockResolvedValueOnce({
      id: 'sess_happy_persist',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify(metadata),
    });
    commitSessionStoredMessageMock.mockResolvedValue({
      didWrite: true,
      messageId: 'msg-1',
      seq: 1,
      createdAt: Date.now(),
    });
    updateSessionMetadataWithRetryMock.mockImplementation(async ({ updater }: { updater: (current: Record<string, unknown>) => Record<string, unknown> }) => ({
      version: 2,
      metadata: updater(metadata),
    }));

    const spawnSession = vi.fn(async (_options: SpawnSessionOptions): Promise<SpawnSessionResult> => ({
      type: 'success',
      sessionId: 'sess_happy_persist',
    }));
    const stopSession = vi.fn(async () => true);
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager, spawnSession, stopSession });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER_PERSIST);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      sessionId: 'sess_happy_persist',
    });

    expect(res).toEqual({ ok: true, converted: true });
    expect(commitSessionStoredMessageMock).toHaveBeenCalledTimes(2);
    expect(spawnSession).toHaveBeenCalledTimes(1);
    expect(updateSessionMetadataWithRetryMock).toHaveBeenCalledTimes(1);
    expect(spawnSession.mock.invocationCallOrder[0]).toBeLessThan(updateSessionMetadataWithRetryMock.mock.invocationCallOrder[0]);
    expect(spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: '/tmp/direct-claude-persist-worktree',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        existingSessionId: 'sess_happy_persist',
        resume: 'sess-claude-persist',
        approvedNewDirectoryCreation: true,
      }),
    );
    expect(spawnSession).toHaveBeenCalledWith(
      expect.not.objectContaining({
        transcriptStorage: 'direct',
      }),
    );
    const metadataUpdateArgs = updateSessionMetadataWithRetryMock.mock.calls[0]?.[0];
    const updatedMetadata = metadataUpdateArgs?.updater?.(metadata);
    expect(updatedMetadata.directSessionV1).toBeUndefined();
    expect(updatedMetadata.path).toBe('/tmp/direct-claude-persist-worktree');
    expect(updatedMetadata.externalHistoryImportV1).toMatchObject({
      v: 1,
      providerId: 'claude',
      remoteSessionId: 'sess-claude-persist',
      source: { kind: 'claudeConfig', projectId: 'proj-persist' },
    });
  });

  it('does not remove direct-session metadata when persisted respawn fails after import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-persist-fail-'));
    const configDir = join(root, '.claude');
    const sessionFile = join(configDir, 'projects', 'proj-persist', 'sess-claude-persist.jsonl');
    await mkdir(join(configDir, 'projects', 'proj-persist'), { recursive: true });
    await writeFile(
      sessionFile,
      [
        jsonlLine({ type: 'user', uuid: 'u1', cwd: '/tmp/direct-claude-persist-worktree', message: { content: 'hello' } }),
        jsonlLine({ type: 'assistant', uuid: 'a1', cwd: '/tmp/direct-claude-persist-worktree', message: { model: 'm', content: [] } }),
      ].join(''),
      'utf8',
    );
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', configDir);

    const metadata = {
      path: '',
      machineId: 'm1',
      flavor: 'claude',
      claudeSessionId: 'sess-claude-persist',
      directSessionV1: {
        v: 1,
        providerId: 'claude',
        machineId: 'm1',
        remoteSessionId: 'sess-claude-persist',
        source: { kind: 'claudeConfig', configDir, projectId: 'proj-persist' },
        linkedAtMs: Date.now(),
      },
    };

    readCredentialsMock.mockResolvedValueOnce({
      token: 'token-direct',
      encryption: { type: 'legacy', secret: new Uint8Array([1, 2, 3]) },
    });
    fetchSessionByIdMock.mockResolvedValueOnce({
      id: 'sess_happy_persist',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify(metadata),
    });
    commitSessionStoredMessageMock.mockResolvedValue({
      didWrite: true,
      messageId: 'msg-1',
      seq: 1,
      createdAt: Date.now(),
    });

    const spawnSession = vi.fn(async (_options: SpawnSessionOptions): Promise<SpawnSessionResult> => ({
      type: 'error',
      errorCode: 'UNEXPECTED',
      errorMessage: 'persisted_spawn_failed',
    }));
    const stopSession = vi.fn(async () => true);
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager, spawnSession, stopSession });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER_PERSIST);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      sessionId: 'sess_happy_persist',
    });

    expect(res).toEqual({ ok: false, errorCode: 'internal_error', error: 'persisted_spawn_failed' });
    expect(commitSessionStoredMessageMock).toHaveBeenCalledTimes(2);
    expect(spawnSession).toHaveBeenCalledTimes(1);
    expect(updateSessionMetadataWithRetryMock).not.toHaveBeenCalled();
  });

  it('returns an explicit refresh result for an old Codex candidate cursor through the real provider', async () => {
    const registered = new Map<string, (params: unknown) => Promise<unknown>>();
    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager: {
      registerHandler: (method, handler) => { registered.set(method, async (request) => await handler(request as Parameters<typeof handler>[0])); },
    } });
    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSIONS_CANDIDATES_LIST)!;
    const cursor = Buffer.from(JSON.stringify({ v: 1, kind: 'index', offset: 50 })).toString('base64url');
    await expect(handler({ machineId: 'm1', providerId: 'codex', source: { kind: 'codexHome', home: 'user' }, cursor }))
      .resolves.toEqual({ ok: false, errorCode: 'invalid_request', error: 'direct_sessions_list_refresh_required', refreshRequired: true });
  });

  it('dispatches candidates.list to the claude adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-'));
    const configDir = join(root, '.claude');
    const sessionFile = join(configDir, 'projects', 'proj-a', 'sess-1.jsonl');
    await mkdir(join(configDir, 'projects', 'proj-a'), { recursive: true });
    await writeFile(sessionFile, jsonlLine({ type: 'assistant', uuid: 'a1', message: { model: 'm', content: [] } }), 'utf8');
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', configDir);

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSIONS_CANDIDATES_LIST);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      providerId: 'claude',
      source: { kind: 'claudeConfig', configDir, projectId: null },
      limit: 10,
    });

    expect(res.ok).toBe(true);
    expect(res.candidates.map((c: any) => c.remoteSessionId)).toEqual(['sess-1']);
  });

  it('advertises ACP session listing as resume-only without granting adjacent direct-session operations', async () => {
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const capability = registered.get('daemon.directSessions.acpSessionList.capability.get');
    expect(capability).toBeDefined();
    await expect(capability!({})).resolves.toEqual({
      ok: true,
      capability: 'acp_session_list_v1',
      protocolVersion: 1,
      sourceKind: 'acpSessionList',
      resumeOnly: true,
    });
    await expect(capability!({ unexpected: true })).resolves.toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'invalid_request',
    }));
  });

  it('dispatches transcript.page to the claude adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-page-'));
    const configDir = join(root, '.claude');
    const sessionFile = join(configDir, 'projects', 'proj-a', 'sess-1.jsonl');
    await mkdir(join(configDir, 'projects', 'proj-a'), { recursive: true });
    await writeFile(
      sessionFile,
      [jsonlLine({ type: 'user', uuid: 'u1', message: { content: 'hello' } }), jsonlLine({ type: 'assistant', uuid: 'a1', message: { model: 'm', content: [] } })].join(''),
      'utf8',
    );
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', configDir);

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TRANSCRIPT_PAGE);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      providerId: 'claude',
      remoteSessionId: 'sess-1',
      source: { kind: 'claudeConfig', configDir, projectId: 'proj-a' },
      direction: 'older',
      maxItems: 10,
      maxBytes: 1024 * 1024,
    });

    expect(res.ok).toBe(true);
    expect(res.items.length).toBeGreaterThanOrEqual(2);
    expect(res.items[0].raw.role).toBe('user');
    expect(res.tailCursor).toBeTruthy();
    const readAfter = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TRANSCRIPT_READ_AFTER);
    expect(await readAfter!({
      machineId: 'm1', providerId: 'claude', remoteSessionId: 'sess-1',
      source: { kind: 'claudeConfig', configDir, projectId: 'proj-a' }, cursor: 'invalid-cursor',
    })).toMatchObject({ ok: true, truncated: true, truncationReason: 'source_discontinuity' });
  });

  it('rejects provider/source mismatches as invalid_request', async () => {
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSIONS_CANDIDATES_LIST);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      providerId: 'codex',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: null },
      limit: 10,
    });

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('invalid_request');
  });

  it('rejects claude source overrides outside the configured config dir', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', '/safe/.claude');

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSIONS_CANDIDATES_LIST);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      providerId: 'claude',
      source: { kind: 'claudeConfig', configDir: '/tmp/rogue-claude', projectId: null },
      limit: 10,
    });

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('invalid_request');
    expect(String(res.error)).toContain('source');
  });

  it('rejects taking over a linked claude direct session when metadata points at an unconfigured config dir', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', '/safe/.claude');

    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-takeover-rogue-'));
    const rogueConfigDir = join(root, '.claude-rogue');
    const sessionFile = join(rogueConfigDir, 'projects', 'proj-rogue', 'sess-rogue.jsonl');
    await mkdir(join(rogueConfigDir, 'projects', 'proj-rogue'), { recursive: true });
    await writeFile(
      sessionFile,
      jsonlLine({
        type: 'user',
        uuid: 'u-rogue',
        cwd: '/tmp/rogue-claude-worktree',
        message: { content: 'hello from rogue source' },
      }),
      'utf8',
    );

    readCredentialsMock.mockResolvedValueOnce({
      token: 'token-direct',
      encryption: { type: 'legacy', secret: new Uint8Array([1, 2, 3]) },
    });
    fetchSessionByIdMock.mockResolvedValueOnce({
      id: 'sess_happy_rogue',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        path: '',
        machineId: 'm1',
        flavor: 'claude',
        claudeSessionId: 'sess-rogue',
        directSessionV1: {
          v: 1,
          providerId: 'claude',
          machineId: 'm1',
          remoteSessionId: 'sess-rogue',
          source: { kind: 'claudeConfig', configDir: rogueConfigDir, projectId: 'proj-rogue' },
          linkedAtMs: Date.now(),
        },
      }),
    });

    const spawnSession = vi.fn(async (_options: SpawnSessionOptions): Promise<SpawnSessionResult> => ({
      type: 'success',
      sessionId: 'sess_happy_rogue',
    }));
    const stopSession = vi.fn(async () => true);
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager, spawnSession, stopSession });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      sessionId: 'sess_happy_rogue',
    });

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('invalid_request');
    expect(String(res.error)).toContain('source');
    expect(spawnSession).not.toHaveBeenCalled();
    expect(stopSession).not.toHaveBeenCalled();
  });

  it('reports canTakeOverPersist=false when a linked direct session cannot be resumed safely', async () => {
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', '/tmp/claude-direct-status');
    readCredentialsMock.mockResolvedValueOnce({
      token: 'token-direct',
      encryption: { type: 'legacy', secret: new Uint8Array([1, 2, 3]) },
    });
    fetchSessionByIdMock.mockResolvedValueOnce({
      id: 'sess_happy_direct_status',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        path: '',
        machineId: 'm1',
        flavor: 'claude',
        claudeSessionId: 'sess-claude-status',
        directSessionV1: {
          v: 1,
          providerId: 'claude',
          machineId: 'm1',
          remoteSessionId: 'sess-claude-status',
          source: { kind: 'claudeConfig', configDir: '/tmp/claude-direct-status', projectId: 'missing-project' },
          linkedAtMs: Date.now(),
        },
      }),
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      sessionId: 'sess_happy_direct_status',
      providerId: 'claude',
      remoteSessionId: 'sess-claude-status',
      source: { kind: 'claudeConfig', configDir: '/tmp/claude-direct-status', projectId: 'missing-project' },
    });

    expect(res.ok).toBe(true);
    expect(res.canTakeOverPersist).toBe(false);
  });

  it('marks claude sessions with recent file activity as active_recently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-status-'));
    const configDir = join(root, '.claude');
    const sessionFile = join(configDir, 'projects', 'proj-a', 'sess-1.jsonl');
    await mkdir(join(configDir, 'projects', 'proj-a'), { recursive: true });
    await writeFile(sessionFile, jsonlLine({ type: 'user', uuid: 'u1', message: { content: 'hello' } }), 'utf8');
    const expectedMtimeMs = Math.trunc((await stat(sessionFile)).mtimeMs);
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', configDir);

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      sessionId: 'sess_happy_1',
      providerId: 'claude',
      remoteSessionId: 'sess-1',
      source: { kind: 'claudeConfig', configDir, projectId: 'proj-a' },
    });

    expect(res.ok).toBe(true);
    expect(res.activity).toBe('active_recently');
    expect(typeof res.lastKnownActivityAtMs).toBe('number');
    expect(res.lastKnownActivityAtMs).toBe(expectedMtimeMs);
  });

  it('marks codex sessions with recent rollout activity as active_recently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-status-codex-'));
    const codexHome = join(root, '.codex');
    const rolloutFile = join(codexHome, 'sessions', 'rollout-2026-03-05T00-00-00-remote_123.jsonl');
    await mkdir(join(codexHome, 'sessions'), { recursive: true });
    await writeFile(rolloutFile, jsonlLine({ any: 'line' }), 'utf8');
    const expectedMtimeMs = Math.trunc((await stat(rolloutFile)).mtimeMs);
    vi.stubEnv('CODEX_HOME', codexHome);

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      sessionId: 'sess_happy_2',
      providerId: 'codex',
      remoteSessionId: 'remote_123',
      source: { kind: 'codexHome', home: 'user' },
    });

    expect(res.ok).toBe(true);
    expect(res.activity).toBe('active_recently');
    expect(res.lastKnownActivityAtMs).toBe(expectedMtimeMs);
  });

  it('marks app-server codex sessions as active_recently from thread metadata when no rollout file exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-status-codex-app-server-'));
    const codexHome = join(root, '.codex');
    const nowUpdatedAtMs = Date.now();
    const nowUpdatedAtSeconds = nowUpdatedAtMs / 1000;
    await mkdir(codexHome, { recursive: true });
    const fakeAppServerPath = await writeFakeCodexAppServerThreadListScript({
      dir: root,
      nonArchivedThreads: [{
        id: 'remote_456',
        updatedAt: nowUpdatedAtSeconds,
        cwd: '/tmp/from-app-server',
      }],
    });
    vi.stubEnv('CODEX_HOME', codexHome);
    vi.stubEnv('HAPPIER_CODEX_APP_SERVER_BIN', fakeAppServerPath);

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      sessionId: 'sess_happy_2_app_server',
      providerId: 'codex',
      remoteSessionId: 'remote_456',
      source: { kind: 'codexHome', home: 'user' },
    });

    expect(res.ok).toBe(true);
    expect(res.activity).toBe('active_recently');
    expect(res.lastKnownActivityAtMs).toBe(Math.trunc(nowUpdatedAtMs));
  });

  it('marks opencode sessions as running when /session/status reports busy', async () => {
    let server: Server | null = null;
    try {
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
        if (req.method === 'GET' && url.pathname === '/global/health') {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ healthy: true, version: 'test' }));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/session/status') {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ remote_123: { type: 'busy' } }));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/session') {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify([{ id: 'remote_123', updatedAtMs: Date.now() }]));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Failed to resolve test server address');
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      vi.stubEnv('HAPPIER_OPENCODE_SERVER_URL', baseUrl);

      const registered = new Map<string, (params: any) => Promise<any>>();
      const rpcHandlerManager = {
        registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
          registered.set(method, handler);
        },
      } as any;

      registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

      const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET);
      expect(handler).toBeDefined();

      const res = await handler!({
        machineId: 'm1',
        sessionId: 'sess_happy_3',
        providerId: 'opencode',
        remoteSessionId: 'remote_123',
        source: { kind: 'opencodeServer', baseUrl, directory: null },
      });

      expect(res.ok).toBe(true);
      expect(res.activity).toBe('running');
    } finally {
      if (server) {
        await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())));
      }
    }
  });

  it('rejects opencode baseUrl overrides outside the configured server url', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HAPPIER_OPENCODE_SERVER_URL', 'http://127.0.0.1:4010');

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_TRANSCRIPT_READ_AFTER);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'm1',
      providerId: 'opencode',
      remoteSessionId: 'remote_123',
      source: { kind: 'opencodeServer', baseUrl: 'http://127.0.0.1:4999', directory: null },
      cursor: 'tail',
    });

    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('invalid_request');
    expect(String(res.error)).toContain('source');
  });

  it('emits direct-session transcript deltas for an attached view and stops after detach', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-follow-'));
    const configDir = join(root, '.claude');
    const sessionDir = join(configDir, 'projects', 'proj-follow');
    const sessionFile = join(sessionDir, 'sess-follow.jsonl');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      sessionFile,
      jsonlLine({ type: 'assistant', uuid: 'a1', message: { model: 'm', content: [] } }),
      'utf8',
    );
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', configDir);
    vi.stubEnv('HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS', '10');

    const emitDirectSessionTranscriptUpdate = vi.fn();
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({
      rpcHandlerManager,
      emitDirectSessionTranscriptUpdate,
    });

    const attachHandler = registered.get((RPC_METHODS as any).DAEMON_DIRECT_SESSION_ATTACH);
    const detachHandler = registered.get((RPC_METHODS as any).DAEMON_DIRECT_SESSION_DETACH);
    expect(attachHandler).toBeDefined();
    expect(detachHandler).toBeDefined();

    const attached = await attachHandler!({
      machineId: 'm1',
      sessionId: 'sess_happy_follow',
      providerId: 'claude',
      remoteSessionId: 'sess-follow',
      source: { kind: 'claudeConfig', configDir, projectId: 'proj-follow' },
      ttlMs: 30_000,
    });

    expect(attached.ok).toBe(true);
    const leaseId = attached.leaseId;
    expect(typeof leaseId).toBe('string');

    await appendFile(
      sessionFile,
      jsonlLine({ type: 'assistant', uuid: 'a2', message: { model: 'm', content: [{ type: 'text', text: 'hello from push' }] } }),
      'utf8',
    );

    await vi.waitFor(() => {
      expect(emitDirectSessionTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
        type: 'direct-session-transcript-delta',
        sessionId: 'sess_happy_follow',
        truncated: false,
        items: expect.arrayContaining([
          expect.objectContaining({
            raw: expect.objectContaining({
              content: expect.objectContaining({
                data: expect.objectContaining({ uuid: 'a2' }),
              }),
            }),
          }),
        ]),
      }));
    }, { timeout: 1000 });

    const beforeDetachCalls = emitDirectSessionTranscriptUpdate.mock.calls.length;
    const detached = await detachHandler!({
      machineId: 'm1',
      sessionId: 'sess_happy_follow',
      leaseId,
    });

    expect(detached).toEqual({ ok: true, detached: true });

    await appendFile(
      sessionFile,
      jsonlLine({ type: 'assistant', uuid: 'a3', message: { model: 'm', content: [{ type: 'text', text: 'after detach' }] } }),
      'utf8',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(emitDirectSessionTranscriptUpdate).toHaveBeenCalledTimes(beforeDetachCalls);
  });

  it('emits direct-session transcript deltas while background follow policy is enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-background-follow-'));
    const configDir = join(root, '.claude');
    const sessionDir = join(configDir, 'projects', 'proj-background-follow');
    const sessionFile = join(sessionDir, 'sess-background-follow.jsonl');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      sessionFile,
      jsonlLine({ type: 'assistant', uuid: 'b1', message: { model: 'm', content: [] } }),
      'utf8',
    );
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', configDir);
    vi.stubEnv('HAPPIER_DIRECT_SESSIONS_FOLLOW_POLL_MS', '10');

    const metadata = {
      directSessionV1: {
        v: 1,
        providerId: 'claude',
        machineId: 'm1',
        remoteSessionId: 'sess-background-follow',
        source: { kind: 'claudeConfig', configDir, projectId: 'proj-background-follow' },
        linkedAtMs: 1,
      },
    };
    const credentials: Credentials = { token: `synthetic.${Buffer.from(JSON.stringify({ sub: 'follow-account' })).toString('base64url')}.signature`,
      encryption: { type: 'legacy', secret: new Uint8Array(32) } };
    readCredentialsMock.mockResolvedValue(credentials);
    let storedMetadata: Record<string, unknown> = metadata;
    fetchSessionByIdMock.mockImplementation(async () => ({
      id: 'sess_happy_background_follow',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify(storedMetadata),
    }));
    updateSessionMetadataWithRetryMock.mockImplementation(async ({ updater }: {
      updater: (current: Record<string, unknown>) => Record<string, unknown>;
    }) => {
      storedMetadata = updater(storedMetadata);
      return { version: 2, metadata: storedMetadata };
    });

    const emitDirectSessionTranscriptUpdate = vi.fn();
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    const lifecycle = registerMachineDirectSessionsRpcHandlers({
      notifications: { credentials, expoPushSender: { sendToAllDevicesAsync: vi.fn(async () => ({ status: 'submitted' as const })) } },
      getDaemonIdentity: async () => ({ accountId: 'follow-account', machineId: 'm1' }),
      rpcHandlerManager,
      emitDirectSessionTranscriptUpdate,
    });

    const policyHandler = registered.get((RPC_METHODS as any).DAEMON_DIRECT_SESSION_FOLLOW_POLICY_SET);
    expect(policyHandler).toBeDefined();

    const enabled = await policyHandler!({
      machineId: 'm1',
      sessionId: 'sess_happy_background_follow',
      providerId: 'claude',
      remoteSessionId: 'sess-background-follow',
      source: { kind: 'claudeConfig', configDir, projectId: 'proj-background-follow' },
      enabled: true,
    });

    expect(enabled).toEqual(expect.objectContaining({
      ok: true,
      enabled: true,
      leaseActive: true,
    }));

    await appendFile(
      sessionFile,
      jsonlLine({ type: 'assistant', uuid: 'b2', message: { model: 'm', content: [{ type: 'text', text: 'background push' }] } }),
      'utf8',
    );

    await vi.waitFor(() => {
      expect(emitDirectSessionTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
        type: 'direct-session-transcript-delta',
        sessionId: 'sess_happy_background_follow',
        truncated: false,
        items: expect.arrayContaining([
          expect.objectContaining({
            raw: expect.objectContaining({
              content: expect.objectContaining({
                data: expect.objectContaining({ uuid: 'b2' }),
              }),
            }),
          }),
        ]),
      }));
    }, { timeout: 1000 });

    const callsBeforeDisable = emitDirectSessionTranscriptUpdate.mock.calls.length;
    const disabled = await policyHandler!({
      machineId: 'm1',
      sessionId: 'sess_happy_background_follow',
      providerId: 'claude',
      remoteSessionId: 'sess-background-follow',
      source: { kind: 'claudeConfig', configDir, projectId: 'proj-background-follow' },
      enabled: false,
    });

    expect(disabled).toEqual(expect.objectContaining({
      ok: true,
      enabled: false,
      leaseActive: false,
    }));

    await appendFile(
      sessionFile,
      jsonlLine({ type: 'assistant', uuid: 'b3', message: { model: 'm', content: [{ type: 'text', text: 'after disable' }] } }),
      'utf8',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(emitDirectSessionTranscriptUpdate).toHaveBeenCalledTimes(callsBeforeDisable);
    await lifecycle.dispose();
  });

  it('persists background-follow policy metadata when enabling follow policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-directSessions-rpc-follow-policy-enable-'));
    const configDir = join(root, '.claude');
    const sessionDir = join(configDir, 'projects', 'proj-follow-policy-enable');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'sess-follow-policy-enable.jsonl'),
      jsonlLine({ type: 'assistant', uuid: 'p1', message: { model: 'm', content: [] } }),
      'utf8',
    );
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', configDir);

    const metadata = {
      directSessionV1: {
        v: 1,
        providerId: 'claude',
        machineId: 'm1',
        remoteSessionId: 'sess-follow-policy-enable',
        source: { kind: 'claudeConfig', configDir, projectId: 'proj-follow-policy-enable' },
        linkedAtMs: 1,
      },
    };
    const credentials: Credentials = { token: `synthetic.${Buffer.from(JSON.stringify({ sub: 'follow-account' })).toString('base64url')}.signature`,
      encryption: { type: 'legacy', secret: new Uint8Array(32) } };
    readCredentialsMock.mockResolvedValue(credentials);
    let storedMetadata: Record<string, unknown> = metadata;
    fetchSessionByIdMock.mockImplementation(async () => ({
      id: 'sess_happy_follow_policy_enable',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify(storedMetadata),
    }));
    updateSessionMetadataWithRetryMock.mockImplementation(async ({ updater }: {
      updater: (current: Record<string, unknown>) => Record<string, unknown>;
    }) => {
      storedMetadata = updater(storedMetadata);
      return { version: 2, metadata: storedMetadata };
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    const lifecycle = registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager,
      notifications: { credentials, expoPushSender: { sendToAllDevicesAsync: vi.fn(async () => ({ status: 'submitted' as const })) } },
      getDaemonIdentity: async () => ({ accountId: 'follow-account', machineId: 'm1' }),
    });

    const policyHandler = registered.get((RPC_METHODS as any).DAEMON_DIRECT_SESSION_FOLLOW_POLICY_SET);
    expect(policyHandler).toBeDefined();

    const enabled = await policyHandler!({
      machineId: 'm1',
      sessionId: 'sess_happy_follow_policy_enable',
      providerId: 'claude',
      remoteSessionId: 'sess-follow-policy-enable',
      source: { kind: 'claudeConfig', configDir, projectId: 'proj-follow-policy-enable' },
      enabled: true,
    });

    expect(enabled).toEqual(expect.objectContaining({
      ok: true,
      enabled: true,
      leaseActive: true,
    }));
    expect(updateSessionMetadataWithRetryMock).toHaveBeenCalledTimes(1);
    const updateArgs = updateSessionMetadataWithRetryMock.mock.calls[0]?.[0];
    const nextMetadata = updateArgs.updater(metadata);
    expect(nextMetadata.directSessionV1.followPolicyV1).toEqual({
      v: 1,
      policy: 'background_follow',
      updatedAtMs: expect.any(Number),
      generation: expect.any(String),
    });
    await lifecycle.dispose();
  });

  it('persists attached-only policy metadata before disabling follow policy', async () => {
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', '/tmp');
    const metadata = {
      directSessionV1: {
        v: 1,
        providerId: 'claude',
        machineId: 'm1',
        remoteSessionId: 'sess-follow-policy-disable',
        source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-follow-policy-disable' },
        linkedAtMs: 1,
        followPolicyV1: {
          v: 1,
          policy: 'background_follow',
          updatedAtMs: 10,
        },
      },
    };
    const credentials: Credentials = { token: `synthetic.${Buffer.from(JSON.stringify({ sub: 'follow-account' })).toString('base64url')}.signature`,
      encryption: { type: 'legacy', secret: new Uint8Array(32) } };
    readCredentialsMock.mockResolvedValue(credentials);
    let storedMetadata: Record<string, unknown> = metadata;
    fetchSessionByIdMock.mockImplementation(async () => ({
      id: 'sess_happy_follow_policy_disable',
      metadataVersion: 1,
      encryptionMode: 'plain',
      metadata: JSON.stringify(storedMetadata),
    }));
    updateSessionMetadataWithRetryMock.mockImplementation(async ({ updater }: {
      updater: (current: Record<string, unknown>) => Record<string, unknown>;
    }) => {
      storedMetadata = updater(storedMetadata);
      return { version: 2, metadata: storedMetadata };
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    const lifecycle = registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager,
      notifications: { credentials, expoPushSender: { sendToAllDevicesAsync: vi.fn(async () => ({ status: 'submitted' as const })) } },
      getDaemonIdentity: async () => ({ accountId: 'follow-account', machineId: 'm1' }),
    });

    const policyHandler = registered.get((RPC_METHODS as any).DAEMON_DIRECT_SESSION_FOLLOW_POLICY_SET);
    expect(policyHandler).toBeDefined();

    const disabled = await policyHandler!({
      machineId: 'm1',
      sessionId: 'sess_happy_follow_policy_disable',
      providerId: 'claude',
      remoteSessionId: 'sess-follow-policy-disable',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-follow-policy-disable' },
      enabled: false,
    });

    expect(disabled).toEqual(expect.objectContaining({
      ok: true,
      enabled: false,
      leaseActive: false,
    }));
    expect(updateSessionMetadataWithRetryMock).toHaveBeenCalledTimes(1);
    const updateArgs = updateSessionMetadataWithRetryMock.mock.calls[0]?.[0];
    const nextMetadata = updateArgs.updater(metadata);
    expect(nextMetadata.directSessionV1.followPolicyV1).toEqual({
      v: 1,
      policy: 'attached_only',
      updatedAtMs: expect.any(Number),
      generation: expect.any(String),
    });
    await lifecycle.dispose();
  });

  it('sets runnerActive=true and activity=running when a happy session runner is active', async () => {
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', '/tmp');
    const markerDir = join('/tmp/happier-test-home', 'tmp', 'daemon-sessions');
    const markerPath = join(markerDir, `pid-${process.pid}.json`);
    await mkdir(markerDir, { recursive: true });
    await writeFile(markerPath, JSON.stringify({
      pid: process.pid,
      happySessionId: 'sess_happy_runner',
      happyHomeDir: '/tmp/happier-test-home',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      flavor: 'claude',
      metadata: { flavor: 'claude', claudeSessionId: 'sess-1' },
    }), 'utf8');

    try {
      const registered = new Map<string, (params: any) => Promise<any>>();
      const rpcHandlerManager = {
        registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
          registered.set(method, handler);
        },
      } as any;

      registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

      const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET);
      expect(handler).toBeDefined();

      const res = await handler!({
        machineId: 'm1',
        sessionId: 'sess_happy_runner',
        providerId: 'claude',
        remoteSessionId: 'sess-1',
        source: { kind: 'claudeConfig', configDir: '/tmp', projectId: null },
      });

      expect(res.ok).toBe(true);
      expect(res.runnerActive).toBe(true);
      expect(res.activity).toBe('running');
      expect(res.canTakeOverDirect).toBe(false);
    } finally {
      await rm(markerPath, { force: true });
    }
  });

  it('sets canForceStop=true when a trusted happy runner pid matches the provider session id', async () => {
    vi.stubEnv('HAPPIER_CLAUDE_CONFIG_DIR', '/tmp');
    const markerDir = join('/tmp/happier-test-home', 'tmp', 'daemon-sessions');
    const markerPath = join(markerDir, `pid-${process.pid}.json`);
    await mkdir(markerDir, { recursive: true });
    await writeFile(markerPath, JSON.stringify({
      pid: process.pid,
      happySessionId: 'sess_other',
      happyHomeDir: '/tmp/happier-test-home',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      flavor: 'claude',
      metadata: { flavor: 'claude', claudeSessionId: 'remote_force_stop' },
    }), 'utf8');

    try {
      const registered = new Map<string, (params: any) => Promise<any>>();
      const rpcHandlerManager = {
        registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
          registered.set(method, handler);
        },
      } as any;

      registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

      const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_STATUS_GET);
      expect(handler).toBeDefined();

      const res = await handler!({
        machineId: 'm1',
        sessionId: 'sess_happy_direct',
        providerId: 'claude',
        remoteSessionId: 'remote_force_stop',
        source: { kind: 'claudeConfig', configDir: '/tmp', projectId: null },
      });

      expect(res.ok).toBe(true);
      expect(res.runnerActive).toBe(false);
      expect(res.canForceStop).toBe(true);
      expect(res.trustedPid).toBe(process.pid);
    } finally {
      await rm(markerPath, { force: true });
    }
  });
});
