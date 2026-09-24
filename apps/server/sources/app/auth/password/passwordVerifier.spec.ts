import { describe, expect, it } from 'vitest';
import { createPasswordVerifier, verifyPasswordVerifier, resolveUnknownPasswordParameters, normalizePasswordLoginName } from './passwordVerifier';

describe('password verifier', () => {
    it('使用独立随机盐且只接受原认证派生值', async () => {
        const first = await createPasswordVerifier('a'.repeat(43));
        const second = await createPasswordVerifier('a'.repeat(43));
        expect(first.verifierSalt).not.toEqual(second.verifierSalt);
        expect(first.verifierHash).not.toContain('a'.repeat(43));
        expect(await verifyPasswordVerifier('a'.repeat(43), first)).toBe(true);
        expect(await verifyPasswordVerifier('b'.repeat(43), first)).toBe(false);
    });
    it('未知账号参数稳定同形且隔离账号及主密钥', () => {
        const env = { HANDY_MASTER_SECRET: 'synthetic-master-secret' };
        const first = resolveUnknownPasswordParameters('alice', env);
        expect(resolveUnknownPasswordParameters('alice', env)).toEqual(first);
        expect(resolveUnknownPasswordParameters('bob', env)).not.toEqual(first);
        expect(first.salt).toHaveLength(43);
        expect(first.credentialId).toHaveLength(43);
        expect(first.salt).not.toEqual(first.credentialId);
        expect(() => resolveUnknownPasswordParameters('alice', {})).toThrow();
    });
    it('账号统一修剪与小写，保留密码原文由上层处理', () => {
        expect(normalizePasswordLoginName(' Alice ')).toBe('alice');
        expect(() => normalizePasswordLoginName('')).toThrow();
        expect(() => normalizePasswordLoginName('x'.repeat(129))).toThrow();
    });
});
