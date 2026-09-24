import { randomBytes, randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import { encodeBase64, encodeHex } from 'privacy-kit';
import { createPasswordAuthParameters, derivePasswordKeys, sealPasswordAccountSecret } from '@happier-dev/protocol';
import { inTx } from '@/storage/inTx';
import { createPasswordVerifier, normalizePasswordLoginName } from './passwordVerifier';
import { readEncryptionFeatureEnv } from '@/app/features/catalog/readFeatureEnv';
import { resolveEffectiveDefaultAccountEncryptionMode } from '@happier-dev/protocol';

/** 仅供本地管理员命令预建独立账号；已存在账号直接失败，绝不迁移或覆盖旧密钥。 */
export async function provisionPasswordAccount(input: { loginName: string; password: string; env: NodeJS.ProcessEnv }): Promise<{ accountId: string }> {
    const loginName = normalizePasswordLoginName(input.loginName);
    if (input.password.length < 12 || input.password.length > 1024) throw new Error('Password must contain 12 to 1024 characters');
    const parameters = createPasswordAuthParameters(randomBytes);
    const keys = await derivePasswordKeys(input.password, parameters);
    const secret = randomBytes(32);
    const pair = nacl.sign.keyPair.fromSeed(secret);
    const publicKey = encodeHex(Uint8Array.from(pair.publicKey));
    const accountId = randomUUID();
    try {
        const verifier = await createPasswordVerifier(encodeBase64(Uint8Array.from(keys.loginSecret), 'base64url').replace(/=+$/, ''));
        const envelope = sealPasswordAccountSecret({ credentialId: parameters.credentialId, accountId, publicKey, secret, wrappingKey: keys.wrappingKey, randomBytes });
        const encryption = readEncryptionFeatureEnv(input.env);
        const encryptionMode = resolveEffectiveDefaultAccountEncryptionMode(encryption.storagePolicy, encryption.defaultAccountMode);
        // 密钥及封套准备放事务外，事务内只原子写入账号与一对一凭据。
        await inTx(async (tx) => {
            await tx.account.create({ data: { id: accountId, publicKey, encryptionMode, passwordCredential: { create: {
                loginName, credentialId: parameters.credentialId, clientSalt: parameters.salt,
                ...verifier, envelope,
            } } } });
        });
        return { accountId };
    } finally {
        secret.fill(0);
        pair.secretKey.fill(0);
        keys.loginSecret.fill(0);
        keys.wrappingKey.fill(0);
    }
}
