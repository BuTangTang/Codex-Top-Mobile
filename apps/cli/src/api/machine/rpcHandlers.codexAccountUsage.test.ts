import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';
import type { RpcHandler } from '@/api/rpc/types';
import { createCodexAppServerProcessEnv, writeFakeCodexAppServerScript } from '@/backends/codex/appServer/testkit/fakeCodexAppServer';
import { resolveServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';
import { createServerUrlComparableKey } from '@happier-dev/protocol';
import { registerCodexAccountUsageRpcHandlers } from './rpcHandlers.codexAccountUsage';

const settings = vi.hoisted(() => ({ binding: null as unknown }));
// 只替换持久化设置边界，来源校验、额度客户端和提供方投影保持真实。
vi.mock('@/persistence', async importOriginal => ({
    ...await importOriginal<typeof import('@/persistence')>(),
    readSettings: async () => ({ passwordAccountBinding: settings.binding }),
}));

/** 在独立目录中接通注册入口和合成提供方进程，不读取真实账号。 */
async function registered(root: string, delay = false) {
    const fake = await writeFakeCodexAppServerScript({
        dir: root,
        bodyLines: [
            'for await (const line of rl) {',
            ' const msg = JSON.parse(line); if (msg.method === "initialized") continue;',
            ' let result = {};',
            ' if (msg.method === "account/read") result = {account:{type:"chatgpt",id:"source-account"}};',
            ' if (msg.method === "account/rateLimits/read") {',
            ...(delay ? ['await new Promise(resolve => setTimeout(resolve, 150));'] : []),
            ' result = {rateLimits:{primary:{usedPercent:25,windowDurationMins:300}}};',
            ' }',
            ' process.stdout.write(JSON.stringify({id:msg.id,result}) + "\\n");',
            '}',
        ],
    });
    const handlers = new Map<string, RpcHandler>();
    registerCodexAccountUsageRpcHandlers({
        rpcHandlerManager: { registerHandler: (name, handler) => { handlers.set(name, handler); } },
        machineId: 'machine-a', accountId: 'product-a', activeServerDir: join(root, 'server'),
        env: createCodexAppServerProcessEnv(fake, { CODEX_HOME: root }),
    });
    return handlers.get('daemon.directSessions.accountUsage.read')!;
}

beforeEach(() => {
    vi.unstubAllEnvs();
    settings.binding = null;
});

describe('Codex account usage machine RPC', () => {
    it('reads the requested machine source through the existing quota owner', async () => {
        await withTempDir('quota-rpc-', async root => {
            const call = await registered(root);
            expect(await call({ machineId: 'machine-a', source: { kind: 'codexHome', home: 'user' } }))
                .toMatchObject({ ok: true, result: { status: 'available', account: { accountId: 'source-account' }, meters: [{ remainingPct: 75 }] } });
        });
    });

    it('rejects a wrong machine and invalid provider source before reading', async () => {
        await withTempDir('quota-rpc-scope-', async root => {
            const call = await registered(root);
            expect(await call({ machineId: 'machine-b', source: { kind: 'codexHome', home: 'user' } }))
                .toMatchObject({ ok: false, errorCode: 'invalid_request' });
            expect(await call({ machineId: 'machine-a', source: { kind: 'claudeConfig' } }))
                .toMatchObject({ ok: false, errorCode: 'invalid_request' });
            expect(await call({ machineId: 'machine-a' })).toMatchObject({ ok: false, errorCode: 'invalid_request' });
        });
    });

    it('keeps unsupported account sources explicit instead of using the native account', async () => {
        await withTempDir('quota-rpc-unsupported-', async root => {
            const call = await registered(root);
            expect(await call({ machineId: 'machine-a', source: { kind: 'codexHome', home: 'connectedService', connectedServiceId: 'openai-codex', connectedServiceProfileId: 'other' } }))
                .toMatchObject({ ok: true, result: { status: 'unavailable', reason: 'unsupported_source' } });
        });
    });

    it('blocks a product account mismatch and drops a read after logout', async () => {
        vi.stubEnv('HAPPIER_PRODUCT_MODE', 'codextop');
        await withTempDir('quota-rpc-account-', async root => {
            const call = await registered(root, true);
            const request = { machineId: 'machine-a', source: { kind: 'codexHome', home: 'user' } };
            expect(await call(request)).toMatchObject({ ok: false, error: 'source_account_mismatch' });
            settings.binding = { accountId: 'product-a', serverKey: createServerUrlComparableKey(resolveServerHttpBaseUrl()) };
            const result = call(request);
            await new Promise(resolve => setTimeout(resolve, 50));
            settings.binding = null;
            expect(await result).toMatchObject({ ok: false, error: 'source_account_mismatch' });
        });
    });
});
