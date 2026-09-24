import type { AcpConfigOptionOverridesV1 } from '@happier-dev/protocol';

function normalizeReasoningEffort(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeUltracode(raw: unknown): boolean | null {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    return null;
}

export function buildClaudeSessionComposerNextMessageMetaOverrides(params: Readonly<{
    configOptionOverrides: AcpConfigOptionOverridesV1 | null | undefined;
    metaOverrides?: Record<string, unknown>;
}>): Record<string, unknown> | undefined {
    const merged = params.metaOverrides ? { ...params.metaOverrides } : undefined;
    const overrides = params.configOptionOverrides?.overrides;
    const reasoningEffort = normalizeReasoningEffort(overrides?.reasoning_effort?.value);
    const ultracode = normalizeUltracode(overrides?.ultracode?.value);
    if (reasoningEffort === null && ultracode === null) {
        return merged;
    }

    return {
        ...(merged ?? {}),
        ...(reasoningEffort !== null ? { reasoningEffort } : {}),
        ...(ultracode !== null ? { ultracode } : {}),
    };
}
