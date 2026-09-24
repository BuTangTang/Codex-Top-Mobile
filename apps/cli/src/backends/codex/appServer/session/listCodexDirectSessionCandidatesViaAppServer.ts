import { buildCodexAgentRuntimeDescriptor } from '@happier-dev/agents';
import {
    type DirectSessionCandidateV1,
} from '@happier-dev/protocol';

import { deriveDirectSessionActivityFromTimestamp } from '@/api/directSessions/activity/deriveDirectSessionActivityFromTimestamp';
import type { CodexAppServerClient } from '../client/createCodexAppServerClient';
import { withCodexAppServerClient } from '../client/withCodexAppServerClient';
import { resolveCodexAppServerProcessEnv } from '../resolveCodexAppServerProcessEnv';
import { isSubagentRollout } from '../../localControl/rolloutDiscovery';
import { readCodexPreviewTitle } from '../../directSessions/readCodexPreviewTitle';

type CodexAppServerThread = Readonly<{
    id: string;
    preview?: string;
    name?: string | null;
    createdAt?: number;
    updatedAt?: number;
    cwd?: string;
    source?: unknown;
    threadSource?: unknown;
}>;

type ThreadListResult = Readonly<{
    data?: unknown;
    nextCursor?: string | null;
}>;

function readThreadListPageSize(env?: NodeJS.ProcessEnv): number {
    const raw = Number.parseInt(String(env?.HAPPIER_CODEX_APP_SERVER_THREAD_LIST_PAGE_SIZE ?? ''), 10);
    const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 200;
    return Math.max(1, Math.min(1000, configured));
}

function asThreadArray(value: unknown): CodexAppServerThread[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is CodexAppServerThread => {
        return Boolean(entry) && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string';
    });
}

/** 所有未归档、归档和续页请求都只读状态库，禁止原生扫描修复 rollout 元数据。 */
async function listThreadsForArchiveStateWithClient(params: Readonly<{
    client: CodexAppServerClient;
    processEnv: NodeJS.ProcessEnv;
    archived: boolean;
}>): Promise<CodexAppServerThread[]> {
    const pageSize = readThreadListPageSize(params.processEnv);
    const out: CodexAppServerThread[] = [];
    let cursor: string | null | undefined = undefined;
    while (true) {
        const result = await params.client.request('thread/list', {
            limit: pageSize,
            sortKey: 'updated_at',
            archived: params.archived,
            useStateDbOnly: true,
            ...(cursor ? { cursor } : {}),
        }) as ThreadListResult;
        out.push(...asThreadArray(result?.data));
        cursor = typeof result?.nextCursor === 'string' && result.nextCursor.trim()
            ? result.nextCursor
            : null;
        if (!cursor) break;
    }
    return out;
}

/** 排除明确的内部代理并报告其身份，防止与 rollout 合并时重新出现。 */
export async function listCodexDirectSessionCandidatesViaExistingAppServerClient(params: Readonly<{
    client: CodexAppServerClient;
    processEnv: NodeJS.ProcessEnv;
    onExcludedSession?: (remoteSessionId: string) => void;
}>): Promise<DirectSessionCandidateV1[]> {
    const [nonArchivedThreads, archivedThreads] = await Promise.all([
        listThreadsForArchiveStateWithClient({ client: params.client, processEnv: params.processEnv, archived: false }),
        listThreadsForArchiveStateWithClient({ client: params.client, processEnv: params.processEnv, archived: true }),
    ]);

    const excluded = new Set([...nonArchivedThreads, ...archivedThreads].filter(isSubagentRollout).map((thread) => thread.id));
    for (const id of excluded) params.onExcludedSession?.(id);

    /** 正式名称优先；只有正文预览才清理注入块并生成短标题。 */
    const toCandidate = (thread: CodexAppServerThread, archived: boolean): DirectSessionCandidateV1 => {
        const createdAtMs = Number.isFinite(thread.createdAt)
            ? Math.trunc((thread.createdAt as number) * 1000)
            : Number.isFinite(thread.updatedAt)
                ? Math.trunc((thread.updatedAt as number) * 1000)
                : 0;
        const updatedAtMs = Number.isFinite(thread.updatedAt) ? Math.trunc((thread.updatedAt as number) * 1000) : createdAtMs;
        const title = typeof thread.name === 'string' && thread.name.trim()
            ? thread.name.trim()
            : typeof thread.preview === 'string' && thread.preview.trim()
                ? readCodexPreviewTitle(thread.preview) ?? undefined
                : undefined;
        const agentRuntimeDescriptorV1 = buildCodexAgentRuntimeDescriptor({
            backendMode: 'appServer',
            vendorSessionId: thread.id,
        });
        return {
            remoteSessionId: thread.id,
            ...(title ? { title } : {}),
            createdAtMs,
            updatedAtMs,
            activity: deriveDirectSessionActivityFromTimestamp({ updatedAtMs, env: params.processEnv ?? process.env }),
            archived,
            details: {
                ...(typeof thread.cwd === 'string' && thread.cwd.trim() ? { cwd: thread.cwd } : {}),
                agentRuntimeDescriptorV1,
                runtimeDescriptor: agentRuntimeDescriptorV1,
                codexBackendMode: 'appServer',
            },
        };
    };

    return [
        ...nonArchivedThreads.filter((thread) => !excluded.has(thread.id)).map((thread) => toCandidate(thread, false)),
        ...archivedThreads.filter((thread) => !excluded.has(thread.id)).map((thread) => toCandidate(thread, true)),
    ];
}

export async function listCodexDirectSessionCandidatesViaAppServer(params: Readonly<{
    codexHome: string;
    env?: NodeJS.ProcessEnv;
}>): Promise<DirectSessionCandidateV1[]> {
    const processEnv = await resolveCodexAppServerProcessEnv({
        processEnv: { ...process.env, ...(params.env ?? {}) },
        affinity: { home: 'user', homePath: params.codexHome },
    });
    return await withCodexAppServerClient({
        processEnv,
        run: async (client) => listCodexDirectSessionCandidatesViaExistingAppServerClient({ client, processEnv }),
    });
}
