import { z } from 'zod';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha512';
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from '../crypto/base64.js';

/** 严格校验规范无填充 base64url，避免宽松解码接受不同凭据表示。 */
function canonicalBytes(value: string, length?: number): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const bytes = decodeBase64(value, 'base64url');
  return (length === undefined || bytes.length === length) && encodeBase64(bytes, 'base64url') === value;
}
const bytes32 = z.string().length(43).refine((value) => canonicalBytes(value, 32));
const accountIdSchema = z.string().min(1).max(256);
const publicKeySchema = z.string().regex(/^[0-9a-fA-F]{64}$/);
const loginNameSchema = z.string().min(1).max(128);
export const PasswordAuthParametersSchema = z.object({
  version: z.literal(1),
  kdf: z.literal('pbkdf2-sha512'),
  iterations: z.literal(220000),
  salt: bytes32,
  credentialId: bytes32,
}).strict();
export type PasswordAuthParameters = z.infer<typeof PasswordAuthParametersSchema>;
export const PasswordEnvelopeSchema = z.object({
  version: z.literal(1),
  nonce: z.string().length(32).refine((value) => canonicalBytes(value, 24)),
  ciphertext: z.string().min(22).max(4096).refine((value) => canonicalBytes(value)),
}).strict();
export type PasswordEnvelope = z.infer<typeof PasswordEnvelopeSchema>;
export const PasswordParametersRequestSchema = z.object({ loginName: loginNameSchema }).strict();
export const PasswordParametersResponseSchema = PasswordAuthParametersSchema;
export const PasswordLoginRequestSchema = z.object({ loginName: loginNameSchema, credentialId: bytes32, loginSecret: bytes32 }).strict();
export const PasswordLoginResponseSchema = z.object({
  token: z.string().min(1), accountId: accountIdSchema, publicKey: publicKeySchema, envelope: PasswordEnvelopeSchema,
}).strict();
export type PasswordParametersRequest = z.infer<typeof PasswordParametersRequestSchema>;
export type PasswordParametersResponse = z.infer<typeof PasswordParametersResponseSchema>;
export type PasswordLoginRequest = z.infer<typeof PasswordLoginRequestSchema>;
export type PasswordLoginResponse = z.infer<typeof PasswordLoginResponseSchema>;
const plaintextSchema = z.object({ version: z.literal(1), credentialId: bytes32, accountId: accountIdSchema, secret: bytes32 }).strict();
type PasswordContext = Readonly<{ credentialId: string; accountId: string; publicKey: string }>;

/** 校验调用方提供的安全随机字节或密钥长度，错误不包含秘密内容。 */
function requireBytes(bytes: Uint8Array, length: number): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new Error('Invalid password auth byte length');
  return bytes;
}
/** 创建凭据独立的随机盐和标识；调用方必须注入平台安全随机源。 */
export function createPasswordAuthParameters(randomBytes: (length: number) => Uint8Array): PasswordAuthParameters {
  return {
    version: 1, kdf: 'pbkdf2-sha512', iterations: 220000,
    salt: encodeBase64(requireBytes(randomBytes(32), 32), 'base64url'),
    credentialId: encodeBase64(requireBytes(randomBytes(32), 32), 'base64url'),
  };
}
export type PasswordMasterKeyDeriver = (input: Readonly<{
  passwordUtf8: Uint8Array;
  salt: Uint8Array;
  iterations: 220000;
  length: 64;
}>) => Promise<Uint8Array>;

/** 保留密码原始 UTF-8 与空白；平台仅可替换相同参数的 PBKDF2，HKDF 和秘密清理仍由协议统一负责。 */
export async function derivePasswordKeys(password: string, parameters: PasswordAuthParameters, deriveMasterKey?: PasswordMasterKeyDeriver): Promise<{ loginSecret: Uint8Array; wrappingKey: Uint8Array }> {
  const parsed = PasswordAuthParametersSchema.parse(parameters);
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) throw new Error('Invalid password length');
  const passwordUtf8 = new TextEncoder().encode(password);
  const derivationSalt = decodeBase64(parsed.salt, 'base64url');
  let master: Uint8Array | undefined;
  try {
    master = deriveMasterKey
      ? await deriveMasterKey({ passwordUtf8, salt: derivationSalt, iterations: parsed.iterations, length: 64 })
      : await pbkdf2Async(sha512, passwordUtf8, derivationSalt, { c: parsed.iterations, dkLen: 64 });
    requireBytes(master, 64);
    const salt = decodeBase64(parsed.credentialId, 'base64url');
    return {
      loginSecret: hkdf(sha512, master, salt, 'codextop/password-auth/v1/loginSecret', 32),
      wrappingKey: hkdf(sha512, master, salt, 'codextop/password-auth/v1/wrappingKey', 32),
    };
  } finally {
    master?.fill(0);
    passwordUtf8.fill(0);
    derivationSalt.fill(0);
  }
}
/** 验证恢复种子属于服务器声明的十六进制账号公钥。 */
function validateContextSecret(context: PasswordContext, secret: Uint8Array): void {
  bytes32.parse(context.credentialId);
  accountIdSchema.parse(context.accountId);
  publicKeySchema.parse(context.publicKey);
  const pair = nacl.sign.keyPair.fromSeed(requireBytes(secret, 32));
  const actual = Array.from(pair.publicKey, (byte) => byte.toString(16).padStart(2, '0')).join('');
  pair.secretKey.fill(0);
  if (actual !== context.publicKey.toLowerCase()) throw new Error('Password account public key mismatch');
}
/** 将账号恢复种子和上下文一同认证加密；明文种子不发送给服务器。 */
export function sealPasswordAccountSecret(input: PasswordContext & { secret: Uint8Array; wrappingKey: Uint8Array; randomBytes: (length: number) => Uint8Array }): PasswordEnvelope {
  validateContextSecret(input, input.secret);
  const nonce = requireBytes(input.randomBytes(24), 24);
  const plaintext = new TextEncoder().encode(JSON.stringify({ version: 1, credentialId: input.credentialId, accountId: input.accountId, secret: encodeBase64(input.secret, 'base64url') }));
  try {
    const ciphertext = nacl.secretbox(plaintext, nonce, requireBytes(input.wrappingKey, 32));
    return { version: 1, nonce: encodeBase64(nonce, 'base64url'), ciphertext: encodeBase64(ciphertext, 'base64url') };
  } finally {
    plaintext.fill(0);
  }
}
/** 解封后验证版本、凭据、账号及种子公钥，拒绝错密和跨账号替换。 */
export function openPasswordAccountSecret(input: PasswordContext & { envelope: PasswordEnvelope; wrappingKey: Uint8Array }): Uint8Array {
  const envelope = PasswordEnvelopeSchema.parse(input.envelope);
  const plaintext = nacl.secretbox.open(decodeBase64(envelope.ciphertext, 'base64url'), decodeBase64(envelope.nonce, 'base64url'), requireBytes(input.wrappingKey, 32));
  if (!plaintext) throw new Error('Invalid password account envelope');
  let secret: Uint8Array | undefined;
  try {
    const parsed = plaintextSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
    if (parsed.credentialId !== input.credentialId || parsed.accountId !== input.accountId) throw new Error('Password account context mismatch');
    secret = decodeBase64(parsed.secret, 'base64url');
    validateContextSecret(input, secret);
    return secret;
  } catch {
    secret?.fill(0);
    throw new Error('Invalid password account envelope');
  } finally {
    plaintext.fill(0);
  }
}
