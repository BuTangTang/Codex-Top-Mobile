import type { Readable } from 'node:stream';
import { z } from 'zod';
import { createServerUrlComparableKey, derivePasswordKeys, isLoopbackHostname, openPasswordAccountSecret, PasswordParametersResponseSchema, PasswordLoginResponseSchema } from '@happier-dev/protocol';
import { encodeBase64 } from '@/api/encryption';
import { configuration } from '@/configuration';
import { readCredentials, updateSettings, writeCredentialsLegacy } from '@/persistence';
import { validateStoredAuthTokenAgainstServer } from '@/auth/validateStoredAuthTokenAgainstActiveServer';
import { printJsonEnvelope } from '@/cli/output/jsonEnvelope';

const inputSchema = z.object({ loginName: z.string().trim().min(1).max(128), password: z.string().min(1).max(1024) }).strict();

/** 仅输出固定错误码，避免底层 HTTP／文件异常泄漏输入、凭据或本机路径。 */
class PasswordCommandError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** 从非终端管道读取单个 JSON；8 KiB 覆盖字段长度上限的 JSON 转义膨胀。 */
export async function readPasswordLoginInput(input: Readable & { isTTY?: boolean }): Promise<z.infer<typeof inputSchema>> {
  if (input.isTTY) throw new PasswordCommandError('stdin_required');
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of input) {
      const bytes = Buffer.from(chunk);
      chunks.push(bytes); length += bytes.length;
      if (length > 8192) throw new PasswordCommandError('invalid_input');
    }
    const bytes = Buffer.concat(chunks);
    try { return inputSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
    catch { throw new PasswordCommandError('invalid_input'); }
    finally { bytes.fill(0); }
  } finally { for (const chunk of chunks) chunk.fill(0); }
}

/** 密码入口只接受 HTTPS 或本机回环开发地址，不把证明值转发给重定向目标。 */
function validateTransport(serverUrl: string): void {
  const url = new URL(serverUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname)))) {
    throw new PasswordCommandError('insecure_transport');
  }
}

/** 原 CLI 凭据 owner 保存密码账号，独立产品目录的首次绑定在退出后仍保留。 */
export async function handleAuthPasswordLogin(args: string[], input: Readable & { isTTY?: boolean } = process.stdin): Promise<void> {
  const kind = 'auth_password_login';
  let secret: Uint8Array | undefined;
  let keys: Awaited<ReturnType<typeof derivePasswordKeys>> | undefined;
  try {
    if (args.length !== 1 || args[0] !== '--json') throw new PasswordCommandError('invalid_arguments');
    const serverUrl = configuration.serverUrl.replace(/\/+$/, '');
    const serverId = configuration.activeServerId;
    const credentialPath = configuration.privateKeyFile;
    validateTransport(serverUrl);
    /** 异步返回只能提交到启动时的产品目录和服务，不追随中途配置变化。 */
    const assertCurrent = () => {
      if (configuration.serverUrl.replace(/\/+$/, '') !== serverUrl || configuration.activeServerId !== serverId || configuration.privateKeyFile !== credentialPath) throw new PasswordCommandError('login_cancelled');
    };
    const values = await readPasswordLoginInput(input); assertCurrent();
    const loginName = values.loginName.toLowerCase();
    /** 固定起始地址且禁止重定向，响应内容不作为可显示的错误消息。 */
    const post = async (path: string, body: unknown): Promise<unknown> => {
      assertCurrent();
      const response = await fetch(`${serverUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error' });
      assertCurrent();
      if (!response.ok) throw new PasswordCommandError(response.status === 401 ? 'invalid_credentials' : response.status === 429 ? 'rate_limited' : 'auth_unavailable');
      const result: unknown = await response.json(); assertCurrent(); return result;
    };
    const parameters = PasswordParametersResponseSchema.parse(await post('/v1/auth/password/parameters', { loginName }));
    keys = await derivePasswordKeys(values.password, parameters); assertCurrent();
    const response = PasswordLoginResponseSchema.parse(await post('/v1/auth/password/login', { loginName, credentialId: parameters.credentialId, loginSecret: encodeBase64(keys.loginSecret, 'base64url') }));
    secret = openPasswordAccountSecret({ ...response, credentialId: parameters.credentialId, wrappingKey: keys.wrappingKey });
    const validation = await validateStoredAuthTokenAgainstServer({ token: response.token, serverUrl }); assertCurrent();
    if (validation.state !== 'valid' || validation.accountId !== response.accountId) throw new PasswordCommandError('auth_unavailable');
    const existing = await readCredentials(); assertCurrent();
    if (existing) throw new PasswordCommandError('already_authenticated');
    const serverKey = createServerUrlComparableKey(serverUrl);
    // 绑定与元数据沿原 settings 锁原子更新；不删除或改写以前账号的历史。
    await updateSettings((settings) => {
      assertCurrent();
      const bound = settings.passwordAccountBinding;
      if (bound && (bound.accountId !== response.accountId || bound.serverKey !== serverKey)) throw new PasswordCommandError('source_account_conflict');
      return { ...settings, passwordAccountBinding: { accountId: response.accountId, loginName, serverKey } };
    });
    assertCurrent();
    await writeCredentialsLegacy({ token: response.token, secret }); assertCurrent();
    await printJsonEnvelope({ ok: true, kind, data: { authenticated: true, accountId: response.accountId, loginName } });
  } catch (error) {
    await printJsonEnvelope({ ok: false, kind, error: { code: error instanceof PasswordCommandError ? error.code : 'auth_unavailable' } });
  } finally { keys?.loginSecret.fill(0); keys?.wrappingKey.fill(0); secret?.fill(0); }
}
