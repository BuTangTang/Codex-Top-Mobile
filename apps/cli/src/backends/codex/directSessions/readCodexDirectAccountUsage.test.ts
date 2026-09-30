import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';

import { createCodexAppServerProcessEnv, writeFakeCodexAppServerScript } from '../appServer/testkit/fakeCodexAppServer';
import { createCodexDirectAccountUsageReader } from './readCodexDirectAccountUsage';

/** 只在临时目录启动合成stdio进程，保留生产客户端、来源解析和数值投影。 */
async function fixture(root: string) {
    const starts = join(root, 'starts');
    const fake = await writeFakeCodexAppServerScript({
        dir: root,
        importLines: ['import { readFileSync, appendFileSync } from "node:fs";', 'import { join } from "node:path";'],
        setupLines: [
            `appendFileSync(${JSON.stringify(starts)}, "start\\n");`,
            'const fixture = JSON.parse(readFileSync(join(process.env.CODEX_HOME, "fixture.json"), "utf8"));',
            'let accountReads = 0;',
        ],
        bodyLines: [
            'for await (const line of rl) {',
            '  if (!line.trim()) continue;',
            '  const msg = JSON.parse(line);',
            '  if (msg.method === "initialized") continue;',
            '  let result;',
            '  if (msg.method === "initialize") result = { serverInfo: { name: "quota-fixture", version: "1" } };',
            '  else if (msg.method === "account/read") result = { account: fixture.accounts[Math.min(accountReads++, fixture.accounts.length - 1)] };',
            '  else if (msg.method === "account/rateLimits/read") {',
            '    await new Promise(resolve => setTimeout(resolve, 30));',
            '    if (fixture.failure) { process.stdout.write(JSON.stringify({ id: msg.id, error: { code: -32000, message: "synthetic-secret-not-for-output" } }) + "\\n"); continue; }',
            '    result = fixture.quota;',
            '  } else throw new Error("Unexpected method: " + msg.method);',
            '  process.stdout.write(JSON.stringify({ id: msg.id, result }) + "\\n");',
            '}',
        ],
    });
    const read = createCodexDirectAccountUsageReader({
        activeServerDir: join(root, 'server'),
        env: createCodexAppServerProcessEnv(fake, { CODEX_HOME: root, HAPPIER_CODEX_APP_SERVER_RPC_LOG_PATH: undefined }),
    });
    return { read, starts };
}

/** 合成来源具备独立目录和提供方账号；测试不会读取真实认证或配置。 */
async function home(root: string, name: string, accounts: unknown[], remaining = 80, failure = false) {
    const homePath = join(root, name);
    await mkdir(homePath, { recursive: true });
    await writeFile(join(homePath, 'fixture.json'), JSON.stringify({
        accounts, failure,
        quota: { rateLimits: { primary: { usedPercent: 100 - remaining, windowDurationMins: 300 } }, access_token: 'synthetic-secret-not-for-output' },
    }));
    return { kind: 'codexHome' as const, home: 'user' as const, homePath };
}

describe('createCodexDirectAccountUsageReader', () => {
    it('keeps a source-confirmed account type usable when the provider omits accountId', async () => {
        await withTempDir('codex-direct-quota-', async root => {
            const { read } = await fixture(root);
            const source = await home(root, 'a', [{ type: 'chatgpt', email: 'synthetic@example.test' }]);
            const result = await read({ source });
            expect(result).toMatchObject({ status: 'available', source,
                account: { type: 'chatgpt', accountId: null, accountLabel: 'synthetic@example.test' },
                meters: [{ remainingPct: 80, windowDurationMs: 18_000_000 }] });
            expect(JSON.stringify(result)).not.toContain('synthetic-secret-not-for-output');
        });
    });

    it('rejects an account switch while quota is being read', async () => {
        await withTempDir('codex-direct-quota-switch-', async root => {
            const { read } = await fixture(root);
            const source = await home(root, 'a', [{ type: 'chatgpt', id: 'account-a' }, { type: 'chatgpt', id: 'account-b' }]);
            expect(await read({ source })).toEqual({ status: 'unavailable', reason: 'account_changed' });
        });
    });

    it('shares only an in-flight same-source read and rereads after it settles', async () => {
        await withTempDir('codex-direct-quota-pending-', async root => {
            const { read, starts } = await fixture(root);
            const source = await home(root, 'a', [{ type: 'chatgpt', id: 'account-a' }]);
            const results = await Promise.all([read({ source }), read({ source })]);
            expect((await readFile(starts, 'utf8')).trim().split('\n')).toHaveLength(1);
            expect(results[0]).toEqual(results[1]);
            await read({ source });
            expect((await readFile(starts, 'utf8')).trim().split('\n')).toHaveLength(2);
        });
    });

    it('keeps two native sources separate even within one machine reader', async () => {
        await withTempDir('codex-direct-quota-sources-', async root => {
            const { read } = await fixture(root);
            const a = await home(root, 'a', [{ type: 'chatgpt', id: 'account-a' }], 80);
            const b = await home(root, 'b', [{ type: 'chatgpt', id: 'account-b' }], 25);
            const results = await Promise.all([read({ source: a }), read({ source: b })]);
            expect(results[0]).toMatchObject({ status: 'available', source: a, account: { accountId: 'account-a' }, meters: [{ remainingPct: 80 }] });
            expect(results[1]).toMatchObject({ status: 'available', source: b, account: { accountId: 'account-b' }, meters: [{ remainingPct: 25 }] });
        });
    });

    it('does not retain a failed result or expose provider diagnostics', async () => {
        await withTempDir('codex-direct-quota-failure-', async root => {
            const { read } = await fixture(root);
            const source = await home(root, 'a', [{ type: 'chatgpt' }], 80, true);
            expect(await read({ source })).toEqual({ status: 'unavailable', reason: 'read_failed' });
            await home(root, 'a', [{ type: 'chatgpt' }]);
            expect(await read({ source })).toMatchObject({ status: 'available' });
        });
    });

    it('never substitutes a connected-service account or a signed-out source', async () => {
        await withTempDir('codex-direct-quota-unavailable-', async root => {
            const { read } = await fixture(root);
            expect(await read({ source: { kind: 'codexHome', home: 'connectedService' } })).toEqual({ status: 'unavailable', reason: 'unsupported_source' });
            const source = await home(root, 'a', [null]);
            expect(await read({ source })).toEqual({ status: 'unavailable', reason: 'account_unavailable' });
        });
    });
});
