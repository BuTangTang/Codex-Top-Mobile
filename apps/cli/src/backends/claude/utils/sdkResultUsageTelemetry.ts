import type { Usage } from '@/api/usage'
import type { SDKResultMessage } from '@/backends/claude/sdk'

type ClaudeResultModelUsageEntry = NonNullable<SDKResultMessage['modelUsage']>[string]

export type ClaudeSdkResultUsageTelemetry = Readonly<{
    modelId: string
    usage: Usage
}>

export type BuildClaudeSdkResultUsageTelemetryOptions = Readonly<{
    contextUsedTokens?: number | null
}>

function readNonNegativeInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.trunc(value)
        : undefined
}

function readPositiveInteger(value: unknown): number | undefined {
    const normalized = readNonNegativeInteger(value)
    return normalized !== undefined && normalized > 0 ? normalized : undefined
}

function sumDefinedNumbers(values: Array<number | undefined>): number {
    return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

function selectResultModelUsage(modelUsage: SDKResultMessage['modelUsage']): Readonly<{
    modelId: string
    usage: ClaudeResultModelUsageEntry
    contextWindowTokens: number
}> | null {
    if (!modelUsage) return null

    let selected: Readonly<{
        modelId: string
        usage: ClaudeResultModelUsageEntry
        contextWindowTokens: number
        effectiveInputTokens: number
    }> | null = null

    for (const [modelIdRaw, usage] of Object.entries(modelUsage)) {
        const modelId = modelIdRaw.trim()
        if (!modelId) continue
        const contextWindowTokens = readPositiveInteger(usage.contextWindow)
        if (contextWindowTokens === undefined) continue
        const effectiveInputTokens = sumDefinedNumbers([
            readNonNegativeInteger(usage.inputTokens),
            readNonNegativeInteger(usage.cacheCreationInputTokens),
            readNonNegativeInteger(usage.cacheReadInputTokens),
        ])
        if (
            selected === null
            || contextWindowTokens > selected.contextWindowTokens
            || (
                contextWindowTokens === selected.contextWindowTokens
                && effectiveInputTokens > selected.effectiveInputTokens
            )
        ) {
            selected = { modelId, usage, contextWindowTokens, effectiveInputTokens }
        }
    }

    if (selected === null) return null
    return {
        modelId: selected.modelId,
        usage: selected.usage,
        contextWindowTokens: selected.contextWindowTokens,
    }
}

export function buildClaudeSdkResultUsageTelemetry(
    result: SDKResultMessage,
    options: BuildClaudeSdkResultUsageTelemetryOptions = {},
): ClaudeSdkResultUsageTelemetry | null {
    if (result.subtype !== 'success') return null

    const selectedModelUsage = selectResultModelUsage(result.modelUsage)
    if (!selectedModelUsage) return null

    const inputTokens = readNonNegativeInteger(result.usage?.input_tokens)
        ?? readNonNegativeInteger(selectedModelUsage.usage.inputTokens)
    const outputTokens = readNonNegativeInteger(result.usage?.output_tokens)
        ?? readNonNegativeInteger(selectedModelUsage.usage.outputTokens)
    if (inputTokens === undefined || outputTokens === undefined) return null

    const cacheCreationInputTokens = readNonNegativeInteger(result.usage?.cache_creation_input_tokens)
        ?? readNonNegativeInteger(selectedModelUsage.usage.cacheCreationInputTokens)
    const cacheReadInputTokens = readNonNegativeInteger(result.usage?.cache_read_input_tokens)
        ?? readNonNegativeInteger(selectedModelUsage.usage.cacheReadInputTokens)
    const contextUsedTokens = readNonNegativeInteger(options.contextUsedTokens)

    return {
        modelId: selectedModelUsage.modelId,
        usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            ...(cacheCreationInputTokens !== undefined ? { cache_creation_input_tokens: cacheCreationInputTokens } : {}),
            ...(cacheReadInputTokens !== undefined ? { cache_read_input_tokens: cacheReadInputTokens } : {}),
            ...(contextUsedTokens !== undefined ? { context_used_tokens: contextUsedTokens } : {}),
            context_window_tokens: selectedModelUsage.contextWindowTokens,
        },
    }
}
