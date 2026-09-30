import { z } from 'zod';
import { DirectSessionsSourceSchema } from '@happier-dev/protocol';

import { validateDirectMachineSource } from '@/api/directSessions/security/validateDirectMachineSource';
import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { isProductAccountBindingValid } from '@/auth/passwordAccountBinding';
import { createCodexDirectAccountUsageReader } from '@/backends/codex/directSessions/readCodexDirectAccountUsage';
import { resolveServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';

const AccountUsageReadRequest = z.object({
    machineId: z.string().trim().min(1),
    source: DirectSessionsSourceSchema,
}).strict();

/** 机器额度沿用当前RPC的归属和来源校验；只按需读取，不建立云端额度副本。 */
export function registerCodexAccountUsageRpcHandlers(params: Readonly<{
    rpcHandlerManager: RpcHandlerRegistrar;
    machineId: string;
    accountId: string | null;
    activeServerDir: string;
    env?: NodeJS.ProcessEnv;
}>): void {
    const boundServerUrl = resolveServerHttpBaseUrl();
    const env = params.env ?? process.env;
    const read = createCodexDirectAccountUsageReader({ activeServerDir: params.activeServerDir, env });
    /** 复用产品账号绑定owner，读取前后均确认该来源仍属于当前连接。 */
    const hasAccess = async (): Promise<boolean> => Boolean(params.accountId)
        && resolveServerHttpBaseUrl() === boundServerUrl
        && await isProductAccountBindingValid({ accountId: params.accountId!, serverUrl: boundServerUrl });

    params.rpcHandlerManager.registerHandler('daemon.directSessions.accountUsage.read', async (raw: unknown) => {
        const parsed = AccountUsageReadRequest.safeParse(raw);
        if (!parsed.success || parsed.data.machineId !== params.machineId) {
            return { ok: false, errorCode: 'invalid_request', error: 'machine_or_source_mismatch' };
        }
        const source = validateDirectMachineSource({ providerId: 'codex', source: parsed.data.source, env });
        if (!source.ok) return { ok: false, errorCode: 'invalid_request', error: 'unsupported_source' };
        try {
            if (!await hasAccess()) return { ok: false, errorCode: 'provider_unavailable', error: 'source_account_mismatch' };
            const result = await read({ source: source.source });
            if (!await hasAccess()) return { ok: false, errorCode: 'provider_unavailable', error: 'source_account_mismatch' };
            return { ok: true, result };
        } catch {
            return { ok: false, errorCode: 'provider_unavailable', error: 'quota_unavailable' };
        }
    });
}
