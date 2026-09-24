import type { MemorySettingsV1 } from '@happier-dev/protocol';

export type MemoryCoveragePolicy =
    | Readonly<{ type: 'full' }>
    | Readonly<{ type: 'latest_messages'; maxSemanticMessagesPerSession: number }>
    | Readonly<{ type: 'latest_days'; days: number }>
    | Readonly<{ type: 'since_enabled' }>;

export type MemoryContentPolicy = Readonly<{
    includeUserMessages: boolean;
    includeAssistantMessages: boolean;
    includeReasoning: boolean;
    includeToolSummaries: boolean;
    includeToolOutputs: boolean;
}>;

export type UiMemorySettings = MemorySettingsV1 & Readonly<{
    coveragePolicy?: MemoryCoveragePolicy;
    contentPolicy?: MemoryContentPolicy;
}>;

export const DEFAULT_MEMORY_COVERAGE_POLICY: MemoryCoveragePolicy = { type: 'full' };

export const DEFAULT_MEMORY_CONTENT_POLICY: MemoryContentPolicy = {
    includeUserMessages: true,
    includeAssistantMessages: true,
    includeReasoning: false,
    includeToolSummaries: false,
    includeToolOutputs: false,
};

export function readMemoryCoveragePolicy(settings: MemorySettingsV1): MemoryCoveragePolicy {
    return (settings as UiMemorySettings).coveragePolicy ?? DEFAULT_MEMORY_COVERAGE_POLICY;
}

export function readMemoryContentPolicy(settings: MemorySettingsV1): MemoryContentPolicy {
    return {
        ...DEFAULT_MEMORY_CONTENT_POLICY,
        ...((settings as UiMemorySettings).contentPolicy ?? {}),
    };
}

export function withMemoryCoveragePolicy(
    settings: MemorySettingsV1,
    coveragePolicy: MemoryCoveragePolicy,
): MemorySettingsV1 {
    return {
        ...(settings as UiMemorySettings),
        coveragePolicy,
    } as MemorySettingsV1;
}

export function withMemoryContentPolicy(
    settings: MemorySettingsV1,
    contentPolicy: MemoryContentPolicy,
): MemorySettingsV1 {
    return {
        ...(settings as UiMemorySettings),
        contentPolicy,
    } as MemorySettingsV1;
}
