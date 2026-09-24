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

describe('local provision and password login', () => {
    it('同一账号两次恢复相同密钥并签发原token，拒绝错密/未知/禁用', async () => {
        const { accountId } = await provisionPasswordAccount({ loginName: ' Alice ', password, env: process.env });
        await expect(provisionPasswordAccount({ loginName: 'alice', password, env: process.env })).rejects.toThrow();
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
