import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServer, type Server } from 'node:http';
import { createServer as createIpcServer, type Server as IpcServer, type Socket } from 'node:net';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { deriveBoxPublicKeyFromSeed } from '@happier-dev/protocol';
import { buildCodexAgentRuntimeDescriptor } from '@happier-dev/agents';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { z } from 'zod';

import { encryptStoredSessionPayload, resolveSessionEncryptionContextFromCredentials, tryDecryptSessionMetadata } from '@/session/transport/encryption/sessionEncryptionContext';
import { bindApiSessionSocketMock, createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import type { Credentials } from '@/persistence';
import type { RpcHandlerRegistrar } from '@/api/rpc/types';

const { mockIo, readCredentialsMock } = vi.hoisted(() => ({
  mockIo: vi.fn(),
  readCredentialsMock: vi.fn<() => Promise<Credentials | null>>(async () => null),
}));

vi.mock('socket.io-client', () => ({
  io: mockIo,
}));
// 原生应用启动属于操作系统边界；关联、provider 分派与 IPC 均保持真实实现。
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(), execFile: vi.fn(),
}));

vi.mock('@/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/persistence')>();
  return {
    ...actual,
    readCredentials: readCredentialsMock,
  };
});

describe('daemon.directSessions.link.ensure (integration)', () => {
  const envKeys = [
    'HAPPIER_SERVER_URL',
    'HAPPIER_WEBAPP_URL',
    'HAPPIER_HOME_DIR',
    'HAPPIER_CLAUDE_CONFIG_DIR',
    'PI_CODING_AGENT_DIR',
    'CODEX_HOME',
  ] as const;
  let envScope = createEnvKeyScope(envKeys);
  let server: Server | null = null;
  let happyHomeDir = '';
  let desktopHome = '';
  let desktopServer: IpcServer | undefined;
  const desktopSockets = new Set<Socket>();
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const desktopId = '01a0d20c-5a82-7ea1-86b9-16c6eb50c1c9';
  let desktopLoaded = false;
  let desktopDiscoveryCount = 0;

  /** 仅为 LINK 的真实 provider 边界提供原生发现应答，不接入真实桌面或生成任务。 */
  async function prepareDesktop(): Promise<void> {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    desktopHome = await createTempDir('hlo-');
    process.env.CODEX_HOME = desktopHome;
    await mkdir(join(desktopHome, 'ipc'), { recursive: true, mode: 0o700 });
    await mkdir(join(desktopHome, 'sessions'));
    await writeFile(join(desktopHome, 'sessions', `rollout-${desktopId}.jsonl`),
      JSON.stringify({ type: 'session_meta', payload: { id: desktopId } }) + '\n');
    const credentials = await readCredentialsMock();
    if (!credentials) throw new Error('Synthetic credentials missing');
    readCredentialsMock.mockResolvedValue({ ...credentials,
      token: `synthetic.${Buffer.from(JSON.stringify({ sub: 'account_test' })).toString('base64url')}.signature` });
    desktopServer = createIpcServer((socket) => {
      desktopSockets.add(socket);
      socket.on('error', () => { /* 合成客户端关闭时无需外部恢复。 */ });
      socket.on('close', () => desktopSockets.delete(socket));
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE(0)) {
          const length = pending.readUInt32LE(0);
          const request = JSON.parse(pending.subarray(4, 4 + length).toString()) as { method: string; requestId: string };
          pending = pending.subarray(4 + length);
          if (request.method !== 'initialize' && request.method !== 'thread-owner-discovery') continue;
          const initialize = request.method === 'initialize';
          if (!initialize) desktopDiscoveryCount++;
          const response = { type: 'response', method: request.method, requestId: request.requestId,
            ...(initialize ? { resultType: 'success', handledByClientId: 'synthetic-follower', result: { clientId: 'synthetic-follower' } }
              : desktopLoaded ? { resultType: 'success', handledByClientId: 'synthetic-owner', result: { supportsUntrustedAppInput: true } }
                : { resultType: 'error', error: 'no-client-found' }) };
          const body = Buffer.from(JSON.stringify(response));
          const header = Buffer.alloc(4);
          header.writeUInt32LE(body.length);
          socket.write(Buffer.concat([header, body]));
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      desktopServer!.once('error', reject);
      desktopServer!.listen(join(desktopHome, 'ipc', 'ipc.sock'), resolve);
    });
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      desktopLoaded = true;
      (args[3] as (error: Error | null) => void)(null);
      return {} as ReturnType<typeof execFile>;
    });
  }

  const sessionsByTag = new Map<string, any>();
  const sessionsById = new Map<string, any>();

  beforeEach(async () => {
    vi.mocked(execFile).mockReset();
    desktopLoaded = false;
    desktopDiscoveryCount = 0;
    sessionsByTag.clear();
    sessionsById.clear();
    envScope = createEnvKeyScope(envKeys);
    happyHomeDir = await createTempDir('happier-directSessions-linkEnsure-');

    const machineKeySeed = new Uint8Array(32).fill(7);
    readCredentialsMock.mockResolvedValue({
      token: 'token_test',
      encryption: {
        type: 'dataKey',
        publicKey: deriveBoxPublicKeyFromSeed(machineKeySeed),
        machineKey: machineKeySeed,
      },
    });

    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

      if (req.method === 'GET' && url.pathname === `/v1/features`) {
        res.statusCode = 404;
        res.end();
        return;
      }

      if (req.method === 'GET' && (url.pathname === `/v2/sessions` || url.pathname === `/v2/sessions/archived`)) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        const sessions = url.pathname === `/v2/sessions` ? Array.from(sessionsByTag.values()) : [];
        res.end(JSON.stringify({ sessions, nextCursor: null, hasNext: false }));
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/v2/sessions/')) {
        const sessionId = decodeURIComponent(url.pathname.slice('/v2/sessions/'.length));
        const session = sessionsById.get(sessionId);
        if (!session) {
          res.statusCode = 404;
          res.end();
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ session }));
        return;
      }

      if (req.method === 'POST' && url.pathname === `/v1/sessions`) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const tag = String(body.tag ?? '');

        const existing = sessionsByTag.get(tag);
        if (existing) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ session: existing }));
          return;
        }

        const session = {
          id: `sess_${sessionsByTag.size + 1}`,
          seq: 1,
          encryptionMode: 'e2ee',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          active: false,
          activeAt: 0,
          metadata: body.metadata,
          metadataVersion: 0,
          agentState: null,
          agentStateVersion: 0,
          pendingCount: 0,
          pendingVersion: 0,
          dataEncryptionKey: body.dataEncryptionKey ?? null,
          share: null,
        };
        sessionsByTag.set(tag, session);
        sessionsById.set(session.id, session);

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ session }));
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve test server address');
    }

    process.env.HAPPIER_SERVER_URL = `http://127.0.0.1:${address.port}`;
    process.env.HAPPIER_WEBAPP_URL = 'http://127.0.0.1:3000';
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    process.env.HAPPIER_CLAUDE_CONFIG_DIR = '/tmp';
    process.env.PI_CODING_AGENT_DIR = happyHomeDir;

    const { reloadConfiguration } = await import('@/configuration');
    reloadConfiguration();

    mockIo.mockReset();
    bindApiSessionSocketMock(
      mockIo,
      createApiSessionSocketStub({
        emit: async (event, args) => {
          if (event !== 'update-metadata') return;
          const [data, callback] = args;
          const sessionId = String((data as { sid?: unknown })?.sid ?? '');
          const expectedVersion = Number((data as { expectedVersion?: unknown })?.expectedVersion ?? Number.NaN);
          const nextMetadata = String((data as { metadata?: unknown })?.metadata ?? '');
          const session = sessionsById.get(sessionId);
          if (!session || !Number.isFinite(expectedVersion) || typeof callback !== 'function') {
            return;
          }

          session.metadata = nextMetadata;
          session.metadataVersion = Math.max(Number(session.metadataVersion ?? 0), expectedVersion) + 1;
          callback({
            result: 'success',
            version: session.metadataVersion,
            metadata: session.metadata,
          });
        },
      }),
    );
  });

  afterEach(async () => {
    Object.defineProperty(process, 'platform', originalPlatform);
    for (const socket of desktopSockets) socket.destroy();
    desktopSockets.clear();
    if (desktopServer) await new Promise<void>((resolve) => desktopServer!.close(() => resolve()));
    desktopServer = undefined;
    if (desktopHome) await removeTempDir(desktopHome);
    desktopHome = '';
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
    }
    server = null;
    if (happyHomeDir) {
      await removeTempDir(happyHomeDir);
    }

    envScope.restore();
    envScope = createEnvKeyScope(envKeys);

    const { reloadConfiguration } = await import('@/configuration');
    reloadConfiguration();
  });

  it('creates a linked direct session row and returns created=true on first call', async () => {
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'machine_1',
      providerId: 'claude',
      remoteSessionId: 'remote_123',
      titleHint: 'Linked Claude Session',
      directoryHint: '/tmp/project-a',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-a' },
    });

    expect(res.ok).toBe(true);
    expect(res.created).toBe(true);
    expect(typeof res.sessionId).toBe('string');

    const createdSession = Array.from(sessionsByTag.values())[0];
    const creds = await readCredentialsMock();
    const meta = tryDecryptSessionMetadata({ credentials: creds!, rawSession: createdSession });
    const parsedMeta = z.object({
      tag: z.string().min(1),
      path: z.string(),
      name: z.string(),
      directSessionV1: z.object({
        providerId: z.string().min(1),
        remoteSessionId: z.string().min(1),
        machineId: z.string().min(1),
      }).passthrough(),
    }).passthrough().safeParse(meta);
    if (!parsedMeta.success) {
      throw new Error('Expected direct session metadata payload');
    }

    expect(parsedMeta.data.tag).toMatch(/^direct:v1:/);
    expect(parsedMeta.data.name).toBe('Linked Claude Session');
    expect(parsedMeta.data.path).toBe('/tmp/project-a');
    expect(parsedMeta.data.directSessionV1.providerId).toBe('claude');
    expect(parsedMeta.data.directSessionV1.remoteSessionId).toBe('remote_123');
    expect(parsedMeta.data.directSessionV1.machineId).toBe('machine_1');
  });

  it('persists codex backend affinity when linking a codex direct session', async () => {
    await prepareDesktop();
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager,
      getDaemonIdentity: async () => ({ accountId: 'account_test', machineId: 'machine_1' }) });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE);
    expect(handler).toBeDefined();

    const request = {
      machineId: 'machine_1',
      providerId: 'codex',
      remoteSessionId: desktopId,
      titleHint: 'Linked Codex Session',
      directoryHint: '/tmp/project-codex',
      codexBackendMode: 'appServer',
      source: { kind: 'codexHome', home: 'user' },
    };
    const res = await handler!(request);

    expect(res.ok).toBe(true);

    const createdSession = sessionsById.get(res.sessionId);
    const creds = await readCredentialsMock();
    const meta = tryDecryptSessionMetadata({ credentials: creds!, rawSession: createdSession });
    const parsedMeta = z.object({
      codexBackendMode: z.enum(['mcp', 'acp', 'appServer']),
      directSessionV1: z.object({
        providerId: z.literal('codex'),
        codexBackendMode: z.enum(['mcp', 'acp', 'appServer']).optional(),
      }).passthrough(),
    }).passthrough().safeParse(meta);
    if (!parsedMeta.success) {
      throw new Error('Expected codex direct session metadata payload');
    }

    expect(parsedMeta.data.codexBackendMode).toBe('appServer');
    expect(parsedMeta.data.directSessionV1.codexBackendMode).toBe('appServer');
    expect(execFile).toHaveBeenCalledTimes(1);
    // 再次明确点开已有关联也必须唤起未加载任务，不能被 ensure 的复用返回跳过。
    desktopLoaded = false;
    const reopened = await handler!(request);
    expect(reopened).toMatchObject({ ok: true, sessionId: res.sessionId, created: false });
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(desktopDiscoveryCount).toBe(4);
  });

  it('rejects a different authenticated account before an explicit desktop open', async () => {
    await prepareDesktop();
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');
    const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
    const rpcHandlerManager: RpcHandlerRegistrar = { registerHandler: (method, handler) => { handlers.set(method, async (raw) => handler(raw as never)); } };
    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager,
      getDaemonIdentity: async () => ({ accountId: 'other_account', machineId: 'machine_1' }) });
    const result = await handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE)!({
      machineId: 'machine_1', providerId: 'codex', remoteSessionId: desktopId,
      source: { kind: 'codexHome', home: 'user' },
    });
    expect(result).toMatchObject({ ok: false, error: 'not_authenticated' });
    expect(execFile).not.toHaveBeenCalled();
    expect(desktopDiscoveryCount).toBe(0);
    expect(sessionsByTag.size).toBe(0);
  });

  it('opens the same canonical target that the linked runtime descriptor will navigate to', async () => {
    await prepareDesktop();
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');
    const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
    const rpcHandlerManager: RpcHandlerRegistrar = { registerHandler: (method, handler) => { handlers.set(method, async (raw) => handler(raw as never)); } };
    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager,
      getDaemonIdentity: async () => ({ accountId: 'account_test', machineId: 'machine_1' }) });
    const result = await handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE)!({
      machineId: 'machine_1', providerId: 'codex', remoteSessionId: '01a0c6f6-f8ba-7380-8d9b-61f75792fc17',
      directoryHint: '/tmp/synthetic-project', source: { kind: 'codexHome', home: 'user' },
      runtimeDescriptor: buildCodexAgentRuntimeDescriptor({ backendMode: 'appServer', vendorSessionId: desktopId,
        home: 'user', homePath: desktopHome }),
    });
    expect(result).toMatchObject({ ok: true });
    expect(execFile).toHaveBeenCalledWith('/usr/bin/open', ['-b', 'com.openai.codex', `codex://threads/${desktopId}?hostId=local`],
      expect.any(Object), expect.any(Function));
  });

  it('reuses an imported persisted task without reopening the desktop or restoring its direct runner metadata', async () => {
    await prepareDesktop();
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');
    const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
    const rpcHandlerManager: RpcHandlerRegistrar = { registerHandler: (method, handler) => { handlers.set(method, async (raw) => handler(raw as never)); } };
    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager,
      getDaemonIdentity: async () => ({ accountId: 'account_test', machineId: 'machine_1' }) });
    const request = { machineId: 'machine_1', providerId: 'codex', remoteSessionId: desktopId,
      directoryHint: '/tmp/synthetic-imported-project', source: { kind: 'codexHome', home: 'user' } };
    const handler = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE)!;
    const initial = await handler(request) as { ok: boolean; sessionId: string };
    expect(initial.ok).toBe(true);
    const rawSession = sessionsById.get(initial.sessionId);
    const credentials = await readCredentialsMock();
    if (!credentials) throw new Error('Synthetic credentials missing');
    const metadata = tryDecryptSessionMetadata({ credentials, rawSession });
    if (!metadata) throw new Error('Synthetic session metadata missing');
    // 复现已有导入完成状态：direct 标识已移除，导入来源保留在同一任务记录内。
    const imported: Record<string, unknown> = { ...metadata, externalHistoryImportV1: {
      v: 1, providerId: 'codex', remoteSessionId: desktopId, importedAtMs: 1, source: request.source,
    } };
    delete imported.directSessionV1;
    rawSession.metadata = encryptStoredSessionPayload({ mode: 'e2ee',
      ctx: resolveSessionEncryptionContextFromCredentials(credentials, rawSession), payload: imported });
    desktopLoaded = false;
    const discoveriesBeforeReopen = desktopDiscoveryCount;
    vi.mocked(execFile).mockClear();
    await expect(handler(request)).resolves.toMatchObject({ ok: true, sessionId: initial.sessionId, created: false });
    expect(execFile).not.toHaveBeenCalled();
    expect(desktopDiscoveryCount).toBe(discoveriesBeforeReopen);
    expect(sessionsByTag.size).toBe(1);
    expect(tryDecryptSessionMetadata({ credentials, rawSession })).toEqual(imported);
  });

  it('creates a linked pi direct session with piSessionId metadata and an active-branch source', async () => {
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');

    const registered = new Map<string, (params: unknown) => Promise<unknown>>();
    const rpcHandlerManager: RpcHandlerRegistrar = {
      registerHandler: (method, handler) => {
        registered.set(method, async (params) => handler(params as never));
      },
    };

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE);
    expect(handler).toBeDefined();

    const res = await handler!({
      machineId: 'machine_1',
      providerId: 'pi',
      remoteSessionId: 'remote_pi_123',
      titleHint: 'Linked Pi Session',
      directoryHint: '/tmp/project-pi',
      source: { kind: 'piAgentDir' },
    }) as { ok: boolean; created: boolean; sessionId: string };

    expect(res.ok).toBe(true);
    expect(res.created).toBe(true);
    expect(typeof res.sessionId).toBe('string');

    const createdSession = sessionsById.get(res.sessionId);
    const creds = await readCredentialsMock();
    const meta = tryDecryptSessionMetadata({ credentials: creds!, rawSession: createdSession });
    const parsedMeta = z.object({
      tag: z.string().min(1),
      name: z.string(),
      path: z.string(),
      piSessionId: z.string(),
      directSessionV1: z.object({
        providerId: z.literal('pi'),
        remoteSessionId: z.string().min(1),
        machineId: z.string().min(1),
        source: z.object({ kind: z.literal('piAgentDir') }).passthrough(),
      }).passthrough(),
    }).passthrough().safeParse(meta);
    if (!parsedMeta.success) {
      throw new Error('Expected pi direct session metadata payload');
    }

    expect(parsedMeta.data.tag).toMatch(/^direct:v1:/);
    expect(parsedMeta.data.name).toBe('Linked Pi Session');
    expect(parsedMeta.data.path).toBe('/tmp/project-pi');
    expect(parsedMeta.data.piSessionId).toBe('remote_pi_123');
    expect(parsedMeta.data.directSessionV1.providerId).toBe('pi');
    expect(parsedMeta.data.directSessionV1.remoteSessionId).toBe('remote_pi_123');
    expect(parsedMeta.data.directSessionV1.source.kind).toBe('piAgentDir');
  });

  it('returns created=false and the same sessionId on repeat calls', async () => {
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE);
    expect(handler).toBeDefined();

    const first = await handler!({
      machineId: 'machine_1',
      providerId: 'claude',
      remoteSessionId: 'remote_123',
      titleHint: 'Linked Claude Session',
      directoryHint: '/tmp/project-a',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-a' },
    });
    const second = await handler!({
      machineId: 'machine_1',
      providerId: 'claude',
      remoteSessionId: 'remote_123',
      titleHint: 'Linked Claude Session',
      directoryHint: '/tmp/project-a',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-a' },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it('refreshes stale missing metadata on repeat link.ensure without creating a new session', async () => {
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE);
    expect(handler).toBeDefined();

    const first = await handler!({
      machineId: 'machine_1',
      providerId: 'claude',
      remoteSessionId: 'remote_123',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-a' },
    });
    const second = await handler!({
      machineId: 'machine_1',
      providerId: 'claude',
      remoteSessionId: 'remote_123',
      titleHint: 'Recovered Claude Session',
      directoryHint: '/tmp/project-a',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-a' },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const updatedSession = sessionsById.get(first.sessionId);
    const creds = await readCredentialsMock();
    const meta = tryDecryptSessionMetadata({ credentials: creds!, rawSession: updatedSession });
    const parsedMeta = z.object({
      path: z.string(),
      name: z.string(),
    }).passthrough().safeParse(meta);
    if (!parsedMeta.success) {
      throw new Error('Expected updated direct session metadata payload');
    }

    expect(parsedMeta.data.name).toBe('Recovered Claude Session');
    expect(parsedMeta.data.path).toBe('/tmp/project-a');
  });

  it('does not overwrite an existing meaningful title on repeat link.ensure', async () => {
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE);
    expect(handler).toBeDefined();

    const first = await handler!({
      machineId: 'machine_1',
      providerId: 'claude',
      remoteSessionId: 'remote_456',
      titleHint: 'Original Claude Session',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-b' },
    });
    const second = await handler!({
      machineId: 'machine_1',
      providerId: 'claude',
      remoteSessionId: 'remote_456',
      titleHint: 'Replacement Title Should Not Win',
      directoryHint: '/tmp/project-b',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-b' },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.sessionId).toBe(second.sessionId);
    expect(second.created).toBe(false);

    const updatedSession = sessionsById.get(first.sessionId);
    const creds = await readCredentialsMock();
    const meta = tryDecryptSessionMetadata({ credentials: creds!, rawSession: updatedSession });
    const parsedMeta = z.object({
      path: z.string(),
      name: z.string(),
    }).passthrough().safeParse(meta);
    if (!parsedMeta.success) {
      throw new Error('Expected preserved direct session metadata payload');
    }

    expect(parsedMeta.data.name).toBe('Original Claude Session');
    expect(parsedMeta.data.path).toBe('/tmp/project-b');
  });

  it('replaces an existing fallback remote-session title on repeat link.ensure', async () => {
    const { registerMachineDirectSessionsRpcHandlers } = await import('./rpcHandlers.directSessions');

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => {
        registered.set(method, handler);
      },
    } as any;

    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager });

    const handler = registered.get(RPC_METHODS.DAEMON_DIRECT_SESSION_LINK_ENSURE);
    expect(handler).toBeDefined();

    const first = await handler!({
      machineId: 'machine_1',
      providerId: 'claude',
      remoteSessionId: 'remote_789',
      titleHint: 'remote_789',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-c' },
    });

    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);

    const firstSession = sessionsById.get(first.sessionId);
    const creds = await readCredentialsMock();
    const firstMeta = tryDecryptSessionMetadata({ credentials: creds!, rawSession: firstSession });
    const firstParsedMeta = z.object({ name: z.string() }).safeParse(firstMeta);
    if (!firstParsedMeta.success) {
      throw new Error('Expected initial direct session metadata payload');
    }
    expect(firstParsedMeta.data.name).toBe('remote_789');

    const second = await handler!({
      machineId: 'machine_1',
      providerId: 'claude',
      remoteSessionId: 'remote_789',
      titleHint: 'Recovered Claude Session',
      source: { kind: 'claudeConfig', configDir: '/tmp', projectId: 'proj-c' },
    });

    expect(second.ok).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.created).toBe(false);

    const updatedSession = sessionsById.get(first.sessionId);
    const updatedMeta = tryDecryptSessionMetadata({ credentials: creds!, rawSession: updatedSession });
    const updatedParsedMeta = z.object({ name: z.string() }).safeParse(updatedMeta);
    if (!updatedParsedMeta.success) {
      throw new Error('Expected refreshed direct session metadata payload');
    }

    expect(updatedParsedMeta.data.name).toBe('Recovered Claude Session');
  });
});
