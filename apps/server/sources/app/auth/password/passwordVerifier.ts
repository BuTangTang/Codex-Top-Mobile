import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { decodeBase64, encodeBase64 } from 'privacy-kit';
import type { PasswordAuthParameters } from '@happier-dev/protocol';

type PasswordVerifier = Readonly<{ verifierSalt: string; verifierHash: string }>;

/** 统一账号检索键，不改变密码内容或借用社交用户名字段。 */
export function normalizePasswordLoginName(value: string): string {
    const name = value.trim().toLowerCase();
    if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Invalid login name');
    return name;
}

/** 采用独立服务端随机盐执行异步慢哈希，避免阻塞事件循环。 */
function hashLoginSecret(secret: string, salt: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        scrypt(secret, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
            if (error) reject(error);
            else resolve(derived);
        });
    });
}

/** 只保存认证派生值的慢哈希及独立盐，绝不保存可登录的派生值。 */
export async function createPasswordVerifier(loginSecret: string): Promise<PasswordVerifier> {
    const salt = randomBytes(32);
    const hash = await hashLoginSecret(loginSecret, salt);
    try {
        return { verifierSalt: encodeBase64(salt, 'base64url').replace(/=+$/, ''), verifierHash: encodeBase64(Uint8Array.from(hash), 'base64url').replace(/=+$/, '') };
    } finally {
        hash.fill(0);
    }
}

/** 已知及未知账号都执行相同慢哈希工作，以恒时比较验证认证派生值。 */
export async function verifyPasswordVerifier(loginSecret: string, verifier: PasswordVerifier): Promise<boolean> {
    const actual = await hashLoginSecret(loginSecret, decodeBase64(verifier.verifierSalt, 'base64url'));
    const expected = decodeBase64(verifier.verifierHash, 'base64url');
    try {
        return expected.length === actual.length && timingSafeEqual(actual, expected);
    } finally {
        actual.fill(0);
    }
}

/** 用现有主密钥生成稳定伪参数，使未知账号与已配置账号的返回形状一致。 */
export function resolveUnknownPasswordParameters(loginName: string, env: NodeJS.ProcessEnv): PasswordAuthParameters {
    const master = env.HANDY_MASTER_SECRET?.trim();
    if (!master) throw new Error('HANDY_MASTER_SECRET is required');
    // 分离域防止同一账号的盐、凭据标识与其他 HMAC 用途混用。
    const derive = (purpose: string): string => encodeBase64(createHmac('sha256', master).update(`codextop/password/v1/${purpose}\0${loginName}`).digest(), 'base64url').replace(/=+$/, '');
    return { version: 1, kdf: 'pbkdf2-sha512', iterations: 220000, salt: derive('salt'), credentialId: derive('credential') };
}
