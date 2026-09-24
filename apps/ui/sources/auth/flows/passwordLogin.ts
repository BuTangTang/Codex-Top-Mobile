import { isLoopbackHostname, openPasswordAccountSecret, PasswordParametersResponseSchema, PasswordLoginResponseSchema } from '@happier-dev/protocol';
import { derivePasswordKeysForLogin } from '@/platform/passwordKdf';
import { serverFetch } from '@/sync/http/client';
import { encodeBase64 } from '@/encryption/base64';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { assertAuthServerScopeCurrent, type AuthServerScope } from '@/auth/context/authServerScope';
import type { ActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';

export class PasswordLoginError extends Error {
    /** 仅暴露可翻译的错误类别，不把远端响应或秘密显示到界面。 */
    constructor(readonly code: 'invalidCredentials' | 'rateLimited' | 'unavailable') {
        super(code);
        this.name = 'PasswordLoginError';
    }
}

/** 在捕获的服务器上完成真实密码认证，并恢复原账号种子供单一认证 owner 保存。 */
export async function passwordLogin(input: AuthServerScope & {
    loginName: string; password: string; expectedActiveServerSnapshot: ActiveServerSnapshot; signal?: AbortSignal;
}): Promise<AuthCredentials> {
    assertAuthServerScopeCurrent(input);
    const loginName = input.loginName.trim().toLowerCase();
    if (!loginName || loginName.length > 128 || !input.password || input.password.length > 1024) throw new PasswordLoginError('invalidCredentials');
    const base = input.expectedActiveServerSnapshot.serverUrl.replace(/\/+$/, '');
    const transport = new URL(base);
    if (transport.username || transport.password || transport.search || transport.hash || (transport.protocol !== 'https:' && !(transport.protocol === 'http:' && isLoopbackHostname(transport.hostname)))) throw new PasswordLoginError('unavailable');
    /** 每次异步边界后检查来源，密码证明只发送到起始服务器，不重试错误凭据。 */
    const post = async (path: string, body: unknown): Promise<unknown> => {
        assertAuthServerScopeCurrent(input);
        const response = await serverFetch(`${base}${path}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: input.signal, redirect: 'error',
        }, { includeAuth: false, retry: 'none' });
        assertAuthServerScopeCurrent(input);
        if (!response.ok) throw new PasswordLoginError(response.status === 429 ? 'rateLimited' : response.status === 401 ? 'invalidCredentials' : 'unavailable');
        const result: unknown = await response.json();
        assertAuthServerScopeCurrent(input);
        return result;
    };
    const parameters = PasswordParametersResponseSchema.parse(await post('/v1/auth/password/parameters', { loginName }));
    assertAuthServerScopeCurrent(input);
    // 平台适配只更换 PBKDF2 的执行位置，后续身份与封套验证仍走同一协议路径。
    const keys = await derivePasswordKeysForLogin(input.password, parameters);
    let secret: Uint8Array | undefined;
    try {
        assertAuthServerScopeCurrent(input);
        const response = PasswordLoginResponseSchema.parse(await post('/v1/auth/password/login', {
            loginName, credentialId: parameters.credentialId, loginSecret: encodeBase64(keys.loginSecret, 'base64url'),
        }));
        assertAuthServerScopeCurrent(input);
        secret = openPasswordAccountSecret({ credentialId: parameters.credentialId, accountId: response.accountId, publicKey: response.publicKey, envelope: response.envelope, wrappingKey: keys.wrappingKey });
        // 封套身份不能替代 token 的真实服务器身份；两者一致后才能保存凭据。
        const profileResponse = await serverFetch(`${base}/v1/account/profile`, { method: 'GET', headers: { Authorization: `Bearer ${response.token}` }, signal: input.signal, redirect: 'error' }, { includeAuth: false, retry: 'none' });
        assertAuthServerScopeCurrent(input);
        if (!profileResponse.ok) throw new PasswordLoginError('unavailable');
        const profile: unknown = await profileResponse.json();
        assertAuthServerScopeCurrent(input);
        if (!profile || typeof profile !== 'object' || !('id' in profile) || profile.id !== response.accountId) throw new PasswordLoginError('unavailable');
        return { token: response.token, secret: encodeBase64(secret, 'base64url'), loginName };
    } finally {
        keys.loginSecret.fill(0);
        keys.wrappingKey.fill(0);
        secret?.fill(0);
    }
}
