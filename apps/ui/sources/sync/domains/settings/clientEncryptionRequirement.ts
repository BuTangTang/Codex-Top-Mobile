import {
    ClientEncryptionRequirementSchema,
    combineClientEncryptionRequirements,
    isAccountEncryptionModeAllowedByClientRequirement,
    isSessionEncryptionModeAllowedByClientRequirement,
    type ClientEncryptionRequirement,
    type SessionEncryptionMode,
} from '@happier-dev/protocol';

type RequirementSettings = Readonly<{
    clientEncryptionRequirementV1?: unknown;
    clientEncryptionRequirementLocalV1?: unknown;
}>;

export function resolveUiClientEncryptionRequirement(params: Readonly<{
    syncedSettings: RequirementSettings;
    localSettings: RequirementSettings;
}>): ClientEncryptionRequirement {
    return combineClientEncryptionRequirements(
        ClientEncryptionRequirementSchema.parse(params.syncedSettings.clientEncryptionRequirementV1),
        ClientEncryptionRequirementSchema.parse(params.localSettings.clientEncryptionRequirementLocalV1),
    );
}

/** 校验账号加密要求；不满足时保留原错误码并显示产品名称。 */
export function assertUiAccountEncryptionModeAllowed(params: Readonly<{
    mode: 'e2ee' | 'plain';
    syncedSettings: RequirementSettings;
    localSettings: RequirementSettings;
}>): void {
    const requirement = resolveUiClientEncryptionRequirement(params);
    if (isAccountEncryptionModeAllowedByClientRequirement(requirement, params.mode)) return;
    throw Object.assign(
        new Error('Codex Top 要求端到端加密，但此账号的设置以明文保存。'),
        { code: 'CLIENT_E2EE_REQUIRED' },
    );
}

export function isUiSessionEncryptionModeAllowed(params: Readonly<{
    mode: SessionEncryptionMode;
    requirement: ClientEncryptionRequirement;
}>): boolean {
    return isSessionEncryptionModeAllowedByClientRequirement(params.requirement, params.mode);
}

/** 校验会话加密要求；拒绝写入时保留原错误码和保护规则。 */
export function assertUiSessionEncryptionModeAllowed(params: Readonly<{
    mode: SessionEncryptionMode;
    requirement: ClientEncryptionRequirement;
}>): void {
    if (isUiSessionEncryptionModeAllowed(params)) return;
    throw Object.assign(
        new Error('Codex Top 要求端到端加密，不会向明文会话写入内容。'),
        { code: 'CLIENT_E2EE_REQUIRED' },
    );
}
