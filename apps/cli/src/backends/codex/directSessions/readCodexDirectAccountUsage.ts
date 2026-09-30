import type { ConnectedServiceQuotaMeterV1, DirectSessionsSource } from '@happier-dev/protocol';

import { withCodexAppServerClient } from '../appServer/client/withCodexAppServerClient';
import { readCodexRateLimitsSnapshot } from '../appServer/readCodexRateLimitsSnapshot';
import { resolveCodexAppServerProcessEnv } from '../appServer/resolveCodexAppServerProcessEnv';
import { readCodexLiveAccountIdentity } from '../connectedServices/codexLiveAccountIdentity';
import { CODEX_RATE_LIMIT_SNAPSHOT_STALE_AFTER_MS, mapCodexRateLimitPayloadToQuotaMeters } from '../connectedServices/mapCodexRateLimitSnapshot';
import { resolveCodexHomeEntriesForDirectSessionsSource } from './resolveCodexHomeEntriesForDirectSessionsSource';

export type CodexDirectQuotaAccount = Readonly<{
    type: string | null;
    accountId: string | null;
    accountLabel: string | null;
}>;

export type CodexDirectAccountUsageResult =
    | Readonly<{
        status: 'available';
        source: DirectSessionsSource;
        account: CodexDirectQuotaAccount;
        fetchedAtMs: number;
        staleAtMs: number;
        meters: readonly ConnectedServiceQuotaMeterV1[];
    }>
    | Readonly<{
        status: 'unavailable';
        reason: 'unsupported_source' | 'source_unavailable' | 'account_unavailable' | 'account_changed' | 'quota_unavailable' | 'read_failed';
    }>;

/** 只投影提供方明确返回的账号字段；邮箱不转成账号ID。 */
function readAccount(value: unknown): CodexDirectQuotaAccount | null {
    if (!value || typeof value !== 'object' || !('account' in value)) return null;
    const account = value.account;
    if (!account || typeof account !== 'object' || Array.isArray(account)) return null;
    const identity = readCodexLiveAccountIdentity(value);
    const type = 'type' in account && typeof account.type === 'string' ? account.type.trim() || null : null;
    if (!type && !identity.activeAccountId) return null;
    return { type, accountId: identity.activeAccountId, accountLabel: identity.accountLabel };
}

/** 将所选机器的原生Codex来源交给已有短连接读取器，不读取托管账号库或历史会话额度。 */
export function createCodexDirectAccountUsageReader(params: Readonly<{
    activeServerDir: string;
    env?: NodeJS.ProcessEnv;
}>): (input: Readonly<{ source: DirectSessionsSource }>) => Promise<CodexDirectAccountUsageResult> {
    // 一个reader归属一次daemon配置；只共享本次连接，不保存已完成的额度或账号。
    const env = { ...(params.env ?? process.env) };
    const pending = new Map<string, Promise<CodexDirectAccountUsageResult>>();
    return async ({ source }): Promise<CodexDirectAccountUsageResult> => {
        if (source.kind !== 'codexHome' || source.home !== 'user') {
            return { status: 'unavailable', reason: 'unsupported_source' };
        }
        try {
            const homes = await resolveCodexHomeEntriesForDirectSessionsSource({ source, activeServerDir: params.activeServerDir, env });
            if (homes.length !== 1) return { status: 'unavailable', reason: 'source_unavailable' };
            const home = homes[0]!;
            const existing = pending.get(home.codexHome);
            if (existing) return await existing;
            const request = (async (): Promise<CodexDirectAccountUsageResult> => {
                const processEnv = await resolveCodexAppServerProcessEnv({ processEnv: env, affinity: { home: 'user', homePath: home.codexHome } });
                return await withCodexAppServerClient({
                    processEnv,
                    run: async (client): Promise<CodexDirectAccountUsageResult> => {
                        const account = readAccount(await client.request('account/read', {}));
                        if (!account) return { status: 'unavailable', reason: 'account_unavailable' };
                        const raw = await readCodexRateLimitsSnapshot(client);
                        const current = readAccount(await client.request('account/read', {}));
                        // 读取期间发生可观察的换号或退出时，不把旧额度归到新来源。
                        if (!current || current.type !== account.type || current.accountId !== account.accountId
                            || current.accountLabel !== account.accountLabel) {
                            return { status: 'unavailable', reason: 'account_changed' };
                        }
                        const fetchedAtMs = Date.now();
                        const meters = mapCodexRateLimitPayloadToQuotaMeters(raw, fetchedAtMs);
                        if (meters.length === 0) return { status: 'unavailable', reason: 'quota_unavailable' };
                        return { status: 'available', source: home.source, account, fetchedAtMs,
                            staleAtMs: fetchedAtMs + CODEX_RATE_LIMIT_SNAPSHOT_STALE_AFTER_MS, meters };
                    },
                });
            })();
            pending.set(home.codexHome, request);
            try {
                return await request;
            } finally {
                if (pending.get(home.codexHome) === request) pending.delete(home.codexHome);
            }
        } catch {
            return { status: 'unavailable', reason: 'read_failed' };
        }
    };
}
