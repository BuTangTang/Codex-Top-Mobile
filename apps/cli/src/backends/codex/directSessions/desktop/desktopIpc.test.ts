import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ socket: null as SyntheticSocket | null }));
// 仅替换操作系统的 socket/文件属性边界，真实分帧、请求关联和失败传播保持不变。
vi.mock('node:net', () => ({ connect: () => {
    const socket = transport.socket!;
    queueMicrotask(() => socket.emit('connect'));
    return socket;
} }));
vi.mock('node:fs/promises', () => ({ lstat: async () => ({
    uid: process.getuid?.(), mode: 0o700,
    isDirectory: () => true, isSymbolicLink: () => false, isSocket: () => true,
}) }));

import { DesktopIpc } from './desktopIpc';

type Request = { requestId: string; method: string; timeoutMs?: number };

/** 独立编码原生小端长度帧，不复用待验证的接收实现。 */
function frame(value: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(value));
    const result = Buffer.alloc(body.length + 4);
    result.writeUInt32LE(body.length);
    body.copy(result, 4);
    return result;
}

/** 合成操作系统传输；仅初始化自动回应，其余消息由用例精确分片。 */
class SyntheticSocket extends EventEmitter {
    destroyed = false;
    writable = true;
    lastRequest: Request | null = null;

    /** 记录真实编码出的请求，并异步返回原协议初始化回执。 */
    write(bytes: Buffer): boolean {
        const request = JSON.parse(bytes.subarray(4).toString()) as Request;
        this.lastRequest = request;
        if (request.method === 'initialize') queueMicrotask(() => this.emit('data', frame({
            type: 'response', requestId: request.requestId, method: request.method,
            resultType: 'success', handledByClientId: 'follower-synthetic',
            result: { clientId: 'follower-synthetic' },
        })));
        return true;
    }

    /** 模拟真正 socket 关闭事件，允许验证未完成缓冲被释放。 */
    destroy(): this {
        if (!this.destroyed) { this.destroyed = true; this.writable = false; this.emit('close'); }
        return this;
    }
}

describe('Desktop IPC frame buffering', () => {
    let ipc: DesktopIpc;
    let socket: SyntheticSocket;

    beforeEach(async () => {
        socket = new SyntheticSocket(); transport.socket = socket;
        ipc = await DesktopIpc.open('/synthetic-codex');
    });
    afterEach(() => { ipc?.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

    /** 创建当前发现请求对应的合法应答，可附加合成大字段。 */
    function discoveryFrame(padding = ''): Buffer {
        return frame({ type: 'response', requestId: socket.lastRequest!.requestId,
            method: 'thread-owner-discovery', resultType: 'success', handledByClientId: 'owner-synthetic',
            result: { supportsUntrustedAppInput: true }, padding });
    }

    /** 完成同一个真实发现请求，让后续控制读取固定在合成 owner。 */
    async function discover(): Promise<void> {
        const pending = ipc.discoverOwner('thread-synthetic');
        socket.emit('data', discoveryFrame());
        await pending;
    }

    /** 构造带完整当前轮的原生快照，padding 只用于真实字节预算验证。 */
    function snapshot(revision: number, padding = ''): unknown {
        return { type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
            sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: 'thread-synthetic',
                change: { type: 'snapshot', revision, conversationState: { id: 'thread-synthetic', requests: [],
                    turns: [{ turnId: 'turn-synthetic', status: 'completed' }], threadRuntimeStatus: { type: 'idle' }, padding } } } };
    }

    /** 仅回执当前完整历史请求，不用未关联快照直接唤醒读取。 */
    function acknowledgeHistory(revision: number): void {
        socket.emit('data', frame({ type: 'response', requestId: socket.lastRequest!.requestId,
            method: 'thread-follower-load-complete-history', resultType: 'success',
            handledByClientId: 'owner-synthetic', result: { revision } }));
    }

    it('accounts received snapshot bytes without serializing the parsed full history again', async () => {
        await discover();
        const bytes = frame(snapshot(10));
        const pending = ipc.readControlSnapshot('thread-synthetic');
        const stringify = vi.spyOn(JSON, 'stringify');
        socket.emit('data', bytes);
        acknowledgeHistory(10);
        await expect(pending).resolves.toMatchObject({ id: 'thread-synthetic' });
        expect(stringify.mock.calls.filter(([value]) => value?.method === 'thread-stream-state-changed')).toHaveLength(0);
    });

    it('allows the correlated read-only history response after five seconds without changing its wire timeout', async () => {
        await discover();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const outcome = ipc.readControlSnapshot('thread-synthetic').then((state) => ({ state }), (error: Error) => ({ error: error.message }));
        expect(socket.lastRequest).toMatchObject({ method: 'thread-follower-load-complete-history', timeoutMs: 5000 });
        socket.emit('data', frame(snapshot(10)));
        await vi.advanceTimersByTimeAsync(9440);
        acknowledgeHistory(10);
        await expect(outcome).resolves.toMatchObject({ state: { id: 'thread-synthetic' } });
    });

    it('still ends an unacknowledged control read at fifteen seconds', async () => {
        await discover();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let settled = false;
        const outcome = ipc.readControlSnapshot('thread-synthetic').catch((error: Error) => error.message).finally(() => { settled = true; });
        socket.emit('data', frame(snapshot(10)));
        await vi.advanceTimersByTimeAsync(14999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(outcome).resolves.toBe('timeout');
    });

    it('keeps ordinary owner discovery at five seconds', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const outcome = ipc.discoverOwner('thread-synthetic').catch((error: Error) => error.message);
        await vi.advanceTimersByTimeAsync(5000);
        await expect(outcome).resolves.toBe('timeout');
    });

    it.each(['current', 'discarded_ack', 'discarded_conflict', 'patch_overflow'] as const)(
        'keeps a bounded snapshot window safe for %s using actual frame sizes', async (variant) => {
            await discover();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            const outcome = ipc.readControlSnapshot('thread-synthetic').then((state) => ({ state }), (error: Error) => ({ error: error.message }));
            const padding = 'x'.repeat(129 * 1024 * 1024);
            socket.emit('data', frame(snapshot(10, padding)));
            if (variant === 'patch_overflow') {
                socket.emit('data', frame({ type: 'broadcast', method: 'thread-stream-state-changed', version: 11,
                    sourceClientId: 'owner-synthetic', params: { hostId: 'local', conversationId: 'thread-synthetic',
                        change: { type: 'patches', baseRevision: 10, revision: 11,
                            patches: [{ op: 'replace', path: ['padding'], value: padding }] } } }));
            } else {
                socket.emit('data', frame(snapshot(11, padding)));
                if (variant === 'discarded_conflict') socket.emit('data', frame(snapshot(10, 'conflicting-state')));
            }
            acknowledgeHistory(variant === 'discarded_ack' ? 10 : 11);
            if (variant === 'current') await expect(outcome).resolves.toMatchObject({ state: { id: 'thread-synthetic' } });
            else await expect(outcome).resolves.toMatchObject({ error: expect.any(String) });
        },
    );

    it('copies a large fragmented frame only linearly before resolving its original request', async () => {
        const discovery = ipc.discoverOwner('thread-synthetic');
        const bytes = discoveryFrame('x'.repeat(4 * 1024 * 1024));
        let copiedBytes = 0;
        const concat = Buffer.concat;
        const copy = Buffer.prototype.copy;
        vi.spyOn(Buffer, 'concat').mockImplementation((list, length) => {
            copiedBytes += length ?? list.reduce((total, entry) => total + entry.length, 0);
            return concat(list, length);
        });
        vi.spyOn(Buffer.prototype, 'copy').mockImplementation(function (this: unknown, ...args: unknown[]) {
            // 原生 Buffer 重载边界保留原参数，计量其真实返回的复制字节数。
            const copied = Reflect.apply(copy, this, args) as number; copiedBytes += copied; return copied;
        });
        for (let offset = 0; offset < bytes.length; offset += 4096) socket.emit('data', bytes.subarray(offset, offset + 4096));
        await expect(discovery).resolves.toBe('owner-synthetic');
        // 约束总复制量而非耗时，避免机器负载影响性能回归结论。
        expect(copiedBytes).toBeLessThanOrEqual(bytes.length * 4);
    });

    it('accepts split headers and multiple frames in one chunk without changing request correlation', async () => {
        const discovery = ipc.discoverOwner('thread-synthetic');
        const unrelated = frame({ type: 'response', requestId: 'unrelated', resultType: 'error', error: 'no-client-found' });
        const expected = discoveryFrame();
        const batch = Buffer.concat([unrelated, expected]);
        socket.emit('data', batch.subarray(0, 1));
        socket.emit('data', batch.subarray(1, 3));
        socket.emit('data', batch.subarray(3, unrelated.length + 2));
        socket.emit('data', batch.subarray(unrelated.length + 2));
        await expect(discovery).resolves.toBe('owner-synthetic');
        expect(ipc.isClosed()).toBe(false);
    });

    it.each([0, 268_435_457])('rejects declared length %s without accepting or retaining its body', async (length) => {
        const discovery = ipc.discoverOwner('thread-synthetic');
        const rejected = expect(discovery).rejects.toThrow('invalid_response');
        const header = Buffer.alloc(4); header.writeUInt32LE(length);
        socket.emit('data', header);
        await rejected;
        expect(socket.destroyed).toBe(true);
    });

    it('releases an incomplete frame and rejects the outstanding request when disconnected', async () => {
        const discovery = ipc.discoverOwner('thread-synthetic');
        const rejected = expect(discovery).rejects.toThrow('connection_closed');
        const bytes = discoveryFrame('x'.repeat(1024 * 1024));
        socket.emit('data', bytes.subarray(0, 128 * 1024));
        socket.destroy();
        await rejected;
        // 断连后只允许保留小帧头，不能继续持有合成正文缓冲。
        const retainedBytes = Object.values(ipc).filter(Buffer.isBuffer).reduce((total, value) => total + value.length, 0);
        expect(retainedBytes).toBeLessThanOrEqual(4);
        expect(ipc.isClosed()).toBe(true);
    });
});
