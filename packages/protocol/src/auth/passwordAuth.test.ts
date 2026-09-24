import { describe, expect, it } from 'vitest';
import { pbkdf2Sync, hkdfSync } from 'node:crypto';
import nacl from 'tweetnacl';
import { encodeBase64 } from '../crypto/base64.js';
import { createPasswordAuthParameters, derivePasswordKeys, sealPasswordAccountSecret, openPasswordAccountSecret, PasswordAuthParametersSchema, PasswordLoginRequestSchema, PasswordParametersRequestSchema } from './passwordAuth.js';

/** 使用合成定值生成随机源，不接触真实凭据。 */
function random(length: number): Uint8Array { return new Uint8Array(length).fill(7); }
/** 生成测试用账号公钥。 */
function publicKey(secret: Uint8Array): string { return Buffer.from(nacl.sign.keyPair.fromSeed(secret).publicKey).toString('hex'); }

describe('passwordAuth v1', () => {
  it('matches independent Node PBKDF2/HKDF vectors without trimming password', async () => {
    const parameters = createPasswordAuthParameters(random);
    const keys = await derivePasswordKeys(' 密码 test ', parameters);
    const master = pbkdf2Sync(' 密码 test ', Buffer.alloc(32, 7), 220000, 64, 'sha512');
    for (const purpose of ['loginSecret', 'wrappingKey'] as const) {
      const expected = hkdfSync('sha512', master, Buffer.alloc(32, 7), Buffer.from(`codextop/password-auth/v1/${purpose}`), 32);
      expect(Buffer.from(keys[purpose]).toString('hex')).toBe(Buffer.from(expected).toString('hex'));
    }
    expect(Buffer.from(keys.loginSecret).toString('hex')).toBe('7bddcbbf723d5857d4497faf04e9eed3ff774324c91712791c23fc40b30e3a96');
    expect(Buffer.from(keys.wrappingKey).toString('hex')).toBe('8d63d7337d0bd0d50f4dfe57cf1d15c00f577df889488e34b97bdabb16f0f4e8');
    expect(keys.loginSecret).not.toEqual(keys.wrappingKey);
    expect((await derivePasswordKeys('密码 test', parameters)).loginSecret).not.toEqual(keys.loginSecret);
  });
  it('opens only the matching password, account, credential and hex public key', async () => {
    const parameters = createPasswordAuthParameters(random);
    const { wrappingKey } = await derivePasswordKeys('synthetic-passphrase', parameters);
    const secret = new Uint8Array(32).fill(11);
    const context = { credentialId: parameters.credentialId, accountId: 'account-test', publicKey: publicKey(secret) };
    const envelope = sealPasswordAccountSecret({ ...context, secret, wrappingKey, randomBytes: random });
    expect(openPasswordAccountSecret({ ...context, envelope, wrappingKey })).toEqual(secret);
    expect(openPasswordAccountSecret({ ...context, publicKey: context.publicKey.toUpperCase(), envelope, wrappingKey })).toEqual(secret);
    const wrong = (await derivePasswordKeys('wrong-passphrase', parameters)).wrappingKey;
    expect(() => openPasswordAccountSecret({ ...context, envelope, wrappingKey: wrong })).toThrow();
    for (const overrides of [{ accountId: 'other' }, { credentialId: encodeBase64(new Uint8Array(32).fill(9), 'base64url') }, { publicKey: '00'.repeat(32) }]) {
      expect(() => openPasswordAccountSecret({ ...context, ...overrides, envelope, wrappingKey })).toThrow();
    }
    const mutated = { ...envelope, ciphertext: (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1) };
    expect(() => openPasswordAccountSecret({ ...context, envelope: mutated, wrappingKey })).toThrow();
  });
  it.each([' 密码 test ', ' 🔐 密码\0tail ', '\0'])('keeps the platform PBKDF2 path byte-compatible for %j', async (password) => {
    const parameters = createPasswordAuthParameters(random);
    const nativeMaster = pbkdf2Sync(password, Buffer.alloc(32, 7), 220000, 64, 'sha512');
    const expectedLogin = Buffer.from(hkdfSync('sha512', nativeMaster, Buffer.alloc(32, 7), Buffer.from('codextop/password-auth/v1/loginSecret'), 32));
    const expectedWrapping = Buffer.from(hkdfSync('sha512', nativeMaster, Buffer.alloc(32, 7), Buffer.from('codextop/password-auth/v1/wrappingKey'), 32));
    const keys = await derivePasswordKeys(password, parameters, async (input) => {
      expect(Buffer.from(input.passwordUtf8)).toEqual(Buffer.from(password, 'utf8'));
      expect(Buffer.from(input.salt)).toEqual(Buffer.alloc(32, 7));
      expect(input.iterations).toBe(220000);
      expect(input.length).toBe(64);
      return nativeMaster;
    });
    expect(Buffer.from(keys.loginSecret)).toEqual(expectedLogin);
    expect(Buffer.from(keys.wrappingKey)).toEqual(expectedWrapping);
    expect(nativeMaster.every((byte) => byte === 0)).toBe(true);
  });
  it('rejects downgraded, oversized, malformed and unknown protocol inputs', () => {
    const parameters = createPasswordAuthParameters(random);
    for (const overrides of [{ iterations: 210000 }, { iterations: 1000000000 }, { version: 2 }, { salt: parameters.salt + '=' }, { credentialId: 'x' }, { extra: true }]) {
      expect(PasswordAuthParametersSchema.safeParse({ ...parameters, ...overrides }).success).toBe(false);
    }
    expect(PasswordParametersRequestSchema.safeParse({ loginName: 'test', password: 'leak' }).success).toBe(false);
    expect(PasswordLoginRequestSchema.safeParse({ loginName: 'test', credentialId: parameters.credentialId, loginSecret: parameters.salt }).success).toBe(true);
    expect(() => createPasswordAuthParameters(() => new Uint8Array(1))).toThrow();
  });
});
