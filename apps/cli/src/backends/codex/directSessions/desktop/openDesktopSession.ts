import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { DirectSessionsProviderUnavailableError } from '@/backends/directSessions/providerOps';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';
import { collectCodexSessionRolloutFiles } from '../collectCodexSessionRolloutFiles';
import { readCodexSessionMetaFromRollout } from '../../localControl/rolloutDiscovery';
import { DesktopIpc, DesktopIpcError } from './desktopIpc';

type OpenTarget = Readonly<{ codexHome: string; remoteSessionId: string; isCurrent: () => boolean }>;
const pendingOpens = new Map<string, Promise<void>>();

/** 原生已有任务入口仅接受 UUID，不允许把任意页面、查询参数或新任务请求拼入 URL。 */
function validateTaskId(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new DirectSessionsProviderUnavailableError('invalid_request');
    }
}

/** 复用既有首行读取确认所选来源确实包含此任务，不创建 app-server 或扫描对话正文。 */
async function assertExistingTask(target: OpenTarget): Promise<void> {
    const files = await collectCodexSessionRolloutFiles(target);
    for (const file of files) {
        const meta = await readCodexSessionMetaFromRollout(file.filePath);
        if (meta?.id === target.remoteSessionId) return;
    }
    throw new DirectSessionsProviderUnavailableError('session_not_found');
}

/** 使用 macOS 官方 URL 处理器打开原任务；不经过 shell，也不发送任务消息。 */
async function launchTask(id: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/open', ['-b', 'com.openai.codex', `codex://threads/${id}?hostId=local`], { timeout: 2_000 }, (error) => {
            if (error) reject(new DirectSessionsProviderUnavailableError('desktop_open_failed'));
            else resolve();
        });
    });
}

/** 未加载时只打开一次并复用同一连接有限发现，原 CONTROL 仍自行关联快照 revision。 */
async function openUnloadedTask(target: OpenTarget): Promise<void> {
    const ipc = await DesktopIpc.open(target.codexHome);
    try {
        try {
            await ipc.discoverOwner(target.remoteSessionId);
            return;
        } catch (error) {
            if (!(error instanceof DesktopIpcError) || !['owner_unavailable', 'timeout'].includes(error.reason)) throw error;
        }
        await assertExistingTask(target);
        if (!target.isCurrent()) throw new DirectSessionsProviderUnavailableError('source_unavailable');
        await launchTask(target.remoteSessionId);
        // 与原 30 秒机器 RPC 配合：复用已初始化连接，最多两次原 5 秒发现；没有后台定时循环。
        for (let attempt = 0; attempt < 2; attempt++) {
            if (!target.isCurrent()) throw new DirectSessionsProviderUnavailableError('source_unavailable');
            try {
                await ipc.discoverOwner(target.remoteSessionId);
                return;
            } catch (error) {
                if (attempt === 1 || !(error instanceof DesktopIpcError)
                    || !['owner_unavailable', 'timeout'].includes(error.reason)) throw error;
                await new Promise<void>((resolve) => setTimeout(resolve, 250));
            }
        }
    } finally { ipc.close(); }
}

/** 仅供手机明确打开已有任务时等待原桌面 owner，不参与后台刷新。 */
export async function openDesktopSession(params: OpenTarget): Promise<void> {
    if (process.platform !== 'darwin') return;
    validateTaskId(params.remoteSessionId);
    const expanded = expandHomeDirPath(params.codexHome);
    if (!isAbsolute(expanded)) throw new DirectSessionsProviderUnavailableError('source_unavailable');
    const codexHome = await realpath(expanded).catch(() => { throw new DirectSessionsProviderUnavailableError('source_unavailable'); });
    if (!params.isCurrent()) throw new DirectSessionsProviderUnavailableError('source_unavailable');
    const key = JSON.stringify([codexHome, params.remoteSessionId]);
    const existing = pendingOpens.get(key);
    if (existing) return existing;
    // 并发点击共享同一稳定错误，不能让其中一个调用泄漏底层异常。
    const pending = openUnloadedTask({ ...params, codexHome }).catch((error: unknown) => {
        if (error instanceof DirectSessionsProviderUnavailableError) throw error;
        throw new DirectSessionsProviderUnavailableError(error instanceof DesktopIpcError ? error.reason : 'source_unavailable');
    });
    pendingOpens.set(key, pending);
    try { await pending; }
    finally { if (pendingOpens.get(key) === pending) pendingOpens.delete(key); }
}
