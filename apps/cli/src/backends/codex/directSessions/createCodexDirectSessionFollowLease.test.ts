import { createServer, type Socket } from 'node:net';
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const environment = vi.hoisted(() => ({ activeServerDir: '', logsDir: '/tmp' }));
// 配置为环境边界；来源解析、真实文件轮询、socket 分帧和 lease 均使用正式实现。
vi.mock('@/configuration', () => ({ configuration: environment }));
import { createCodexDirectSessionFollowLease } from './createCodexDirectSessionFollowLease';

afterEach(() => vi.unstubAllEnvs());

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
          followers.push(socket); snapshot(socket, false);
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
