import { derivePasswordKeys, type PasswordAuthParameters } from '@happier-dev/protocol';
import { deriveNativePasswordMasterKey } from '@/sync/encryption/nativeCryptoWorker/nativeCryptoWorker.native';

/** Android 把慢 PBKDF2 交给原生后台队列，协议参数、HKDF 和封套密钥保持一致。 */
export function derivePasswordKeysForLogin(password: string, parameters: PasswordAuthParameters) {
    return derivePasswordKeys(password, parameters, deriveNativePasswordMasterKey);
}
