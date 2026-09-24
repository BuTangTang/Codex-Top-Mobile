import type { UsageLimitRecoverySettingsV1 } from '@happier-dev/protocol';

type UsageLimitRecoverySettingsRecord = UsageLimitRecoverySettingsV1 & Record<string, unknown>;

function readResumePromptMode(value: unknown): UsageLimitRecoverySettingsV1['resumePromptMode'] {
    return value === 'off' || value === 'custom' ? value : 'standard';
}

function readCustomResumePrompt(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().slice(0, 2000);
    return trimmed.length > 0 ? trimmed : null;
}

export function updateUsageLimitRecoveryRememberedMode(
    current: UsageLimitRecoverySettingsV1 | null | undefined,
    mode: UsageLimitRecoverySettingsV1['mode'],
): UsageLimitRecoverySettingsRecord {
    const base: Record<string, unknown> = current && typeof current === 'object'
        ? { ...(current as Record<string, unknown>) }
        : {};
    const customResumePrompt = readCustomResumePrompt(base.customResumePrompt);
    if (customResumePrompt) {
        base.customResumePrompt = customResumePrompt;
    } else {
        delete base.customResumePrompt;
    }

    return {
        ...base,
        v: 1,
        mode,
        promptMode: 'standard',
        resumePromptMode: readResumePromptMode(base.resumePromptMode),
    };
}
