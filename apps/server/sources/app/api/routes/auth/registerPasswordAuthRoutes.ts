import { z } from 'zod';
import { PasswordParametersRequestSchema, PasswordParametersResponseSchema, PasswordLoginRequestSchema, PasswordLoginResponseSchema, PasswordEnvelopeSchema } from '@happier-dev/protocol';
import type { Fastify } from '../../types';
import { db } from '@/storage/db';
import { auth } from '@/app/auth/auth';
import { enforceLoginEligibility } from '@/app/auth/enforceLoginEligibility';
import { resolveUnknownPasswordParameters, verifyPasswordVerifier } from '@/app/auth/password/passwordVerifier';
import { resolveApiHotEndpointRateLimit } from '../../utils/apiRateLimitCatalog';

/** 注册参数和登录两个接口；所有失败隐藏账号存在性且不公开注册入口。 */
export function registerPasswordAuthRoutes(app: Fastify): void {
    const errorSchema = z.object({ error: z.literal('invalid-credentials') });
    app.post('/v1/auth/password/parameters', {
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, 'auth.password.parameters') },
        schema: { body: PasswordParametersRequestSchema, response: { 200: PasswordParametersResponseSchema } },
    }, async (request, reply) => {
        // 无效但满足协议长度的账号仍走伪参数，避免参数接口成为存在性探测器。
        const loginName = request.body.loginName.trim().toLowerCase();
        const fallback = resolveUnknownPasswordParameters(loginName, process.env);
        const row = await db.passwordCredential.findUnique({ where: { loginName } });
        return reply.send(row ? { ...fallback, salt: row.clientSalt, credentialId: row.credentialId } : fallback);
    });
    app.post('/v1/auth/password/login', {
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, 'auth.password.login') },
        schema: { body: PasswordLoginRequestSchema, response: { 200: PasswordLoginResponseSchema, 401: errorSchema } },
    }, async (request, reply) => {
        const loginName = request.body.loginName.trim().toLowerCase();
        const row = await db.passwordCredential.findUnique({ where: { loginName }, include: { account: { select: { publicKey: true } } } });
        const fallback = resolveUnknownPasswordParameters(loginName, process.env);
        // 未知账号也承担完整 scrypt，伪哈希不可能赋予实际账号登录权限。
        const matches = await verifyPasswordVerifier(request.body.loginSecret, row ?? { verifierSalt: fallback.salt, verifierHash: fallback.credentialId });
        if (!row || !matches || row.credentialId !== request.body.credentialId || !row.account.publicKey) {
            return reply.code(401).send({ error: 'invalid-credentials' });
        }
        const eligible = await enforceLoginEligibility({ accountId: row.accountId, env: process.env });
        if (!eligible.ok) return reply.code(401).send({ error: 'invalid-credentials' });
        await auth.init();
        const token = await auth.createToken(row.accountId);
        return reply.send({ token, accountId: row.accountId, publicKey: row.account.publicKey, envelope: PasswordEnvelopeSchema.parse(row.envelope) });
    });
}
