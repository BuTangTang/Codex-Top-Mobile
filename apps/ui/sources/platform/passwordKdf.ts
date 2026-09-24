import { derivePasswordKeys, type PasswordAuthParameters } from '@happier-dev/protocol';

/** 非 Android 平台保留既有协议实现，避免改变桌面、网页和 iOS 的兼容行为。 */
export function derivePasswordKeysForLogin(password: string, parameters: PasswordAuthParameters) {
    return derivePasswordKeys(password, parameters);
}
