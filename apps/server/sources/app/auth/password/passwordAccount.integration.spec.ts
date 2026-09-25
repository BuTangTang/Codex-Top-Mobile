import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
// 测试使用运行时内置 SQLite，不新增依赖；声明最小执行接口兼容仓库 Node 20 类型。
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void } };
import { encodeBase64 } from 'privacy-kit';
import { derivePasswordKeys, openPasswordAccountSecret, PasswordAuthParametersSchema, PasswordLoginResponseSchema } from '@happier-dev/protocol';
import { db, initDbSqlite, shutdownDbClient } from '@/storage/prisma';
import { provisionPasswordAccount } from './provisionPasswordAccount';
import { registerPasswordAuthRoutes } from '@/app/api/routes/auth/registerPasswordAuthRoutes';
import { createFakeRouteApp, createReplyStub, getRouteHandler } from '@/app/api/testkit/routeHarness';
import { disableAccount } from '@/app/auth/accountDisable';
import { auth } from '@/app/auth/auth';

const folder = mkdtempSync(join(tmpdir(), 'codextop-password-test-'));
const originalEnv = { ...process.env };
const app = createFakeRouteApp();
const password = 'Synthetic-only-password-324!';
/** 通过真实注册的处理器驱动独立数据库，不替换认证、事务或密钥算法。 */
async function post(path: string, body: unknown) {
    const reply = createReplyStub();
    const value = await getRouteHandler(app, 'POST', path)({ body }, reply);
    return { status: reply.statusCode, value };
}

beforeAll(async () => {
    process.env.HAPPIER_DB_PROVIDER = 'sqlite';
    process.env.DATABASE_URL = `file:${join(folder, 'isolated.sqlite')}`;
    process.env.HANDY_MASTER_SECRET = 'synthetic-password-test-master-key';
    process.env.AUTH_REQUIRED_LOGIN_PROVIDERS = '';
    // 仅为新建临时目录建表；绝不使用进程继承的数据库 URL。
    const sqlite = new DatabaseSync(join(folder, 'isolated.sqlite'));
    try {
        for (const name of readdirSync('prisma/sqlite/migrations').filter((name) => /^\d/.test(name)).sort()) {
            sqlite.exec(readFileSync(join('prisma/sqlite/migrations', name, 'migration.sql'), 'utf8'));
        }
    } finally { sqlite.close(); }
    await initDbSqlite();
    registerPasswordAuthRoutes(app as never);
}, 30000);

afterAll(async () => {
    await shutdownDbClient();
    process.env = originalEnv;
    rmSync(folder, { recursive: true, force: true });
});

/** 通过真实临时数据库验证管理员开户规则与原密码登录链，不操作已有账号数据。 */
describe('local provision and password login', () => {
    /** 越界密码在开户前失败，不能留下账号或凭据。 */
    it.each([7, 1025])('拒绝 %i 位密码且不写入账号', async (length) => {
        const loginName = `rejected-length-${length}`;
        const before = await db.account.count();
        await expect(provisionPasswordAccount({ loginName, password: 'p'.repeat(length), env: process.env })).rejects.toThrow();
        expect(await db.account.count()).toBe(before);
        expect(await db.passwordCredential.findUnique({ where: { loginName } })).toBeNull();
    });

    /** 下限、用户所需长度和上限均能开户，再通过原登录链恢复同一账号。 */
    it.each([8, 9, 1024])('允许 %i 位密码开户并登录', async (length) => {
        const loginName = `accepted-length-${length}`;
        const password = 'p'.repeat(length);
        const { accountId } = await provisionPasswordAccount({ loginName, password, env: process.env });
        const parameters = PasswordAuthParametersSchema.parse((await post('/v1/auth/password/parameters', { loginName })).value);
        const keys = await derivePasswordKeys(password, parameters);
        try {
            const response = await post('/v1/auth/password/login', {
                loginName, credentialId: parameters.credentialId,
                loginSecret: encodeBase64(Uint8Array.from(keys.loginSecret), 'base64url').replace(/=+$/, ''),
            });
            expect(response.status).toBe(200);
            expect(PasswordLoginResponseSchema.parse(response.value).accountId).toBe(accountId);
        } finally {
            keys.loginSecret.fill(0);
            keys.wrappingKey.fill(0);
        }
    });

    /** 已有账号不被不同密码覆盖，重复登录恢复原密钥，错误或禁用凭据仍被拒绝。 */
    it('同一账号两次恢复相同密钥并签发原token，拒绝错密/未知/禁用', async () => {
        const { accountId } = await provisionPasswordAccount({ loginName: ' Alice ', password, env: process.env });
        const originalCredential = await db.passwordCredential.findUniqueOrThrow({ where: { accountId } });
        const accountCount = await db.account.count();
        await expect(provisionPasswordAccount({ loginName: 'alice', password: 'Different-synthetic-password-567!', env: process.env })).rejects.toThrow();
        expect(await db.passwordCredential.findUniqueOrThrow({ where: { accountId } })).toEqual(originalCredential);
        expect(await db.account.count()).toBe(accountCount);
        const params = PasswordAuthParametersSchema.parse((await post('/v1/auth/password/parameters', { loginName: 'ALICE' })).value);
        const unknown = PasswordAuthParametersSchema.parse((await post('/v1/auth/password/parameters', { loginName: 'missing' })).value);
        expect(Object.keys(unknown)).toEqual(Object.keys(params));
        const keys = await derivePasswordKeys(password, params);
        const request = { loginName: 'alice', credentialId: params.credentialId, loginSecret: encodeBase64(Uint8Array.from(keys.loginSecret), 'base64url').replace(/=+$/, '') };
        const first = await post('/v1/auth/password/login', request);
        const second = await post('/v1/auth/password/login', request);
        expect(first.status).toBe(200);
        const firstResponse = PasswordLoginResponseSchema.parse(first.value);
        const secondResponse = PasswordLoginResponseSchema.parse(second.value);
        expect(firstResponse.accountId).toBe(accountId);
        expect(await auth.verifyToken(firstResponse.token)).toMatchObject({ userId: accountId });
        const secret = openPasswordAccountSecret({ ...firstResponse, credentialId: params.credentialId, wrappingKey: keys.wrappingKey });
        expect(openPasswordAccountSecret({ ...secondResponse, credentialId: params.credentialId, wrappingKey: keys.wrappingKey })).toEqual(secret);
        const row = await db.passwordCredential.findUniqueOrThrow({ where: { accountId } });
        expect(JSON.stringify(row)).not.toContain(password);
        expect(row.verifierHash).not.toBe(request.loginSecret);
        const wrong = await post('/v1/auth/password/login', { ...request, loginSecret: unknown.salt });
        const missing = await post('/v1/auth/password/login', { ...request, loginName: 'missing' });
        await disableAccount({ accountId, reason: 'synthetic-test', env: process.env });
        const disabled = await post('/v1/auth/password/login', request);
        expect(wrong).toEqual({ status: 401, value: { error: 'invalid-credentials' } });
        expect(missing).toEqual(wrong);
        expect(disabled).toEqual(wrong);
        keys.loginSecret.fill(0); keys.wrappingKey.fill(0); secret.fill(0);
    });
});
