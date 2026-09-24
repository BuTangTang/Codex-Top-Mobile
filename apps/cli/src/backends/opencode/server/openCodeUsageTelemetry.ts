import { asRecord, normalizeString } from './openCodeParsing';

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readContextWindowTokens(value: unknown): number | null {
  const parsed = readNonNegativeNumber(value);
  return parsed !== null ? Math.trunc(parsed) : null;
}

function readProviderModelId(info: Record<string, unknown>): string | null {
  const nestedModel = asRecord(info.model);
  const providerID = normalizeString(info.providerID ?? nestedModel?.providerID);
  const modelID = normalizeString(info.modelID ?? nestedModel?.modelID);
  if (!providerID || !modelID) return null;
  return `${providerID}/${modelID}`;
}

function readUsageTotalTokens(tokens: Record<string, unknown> | null): number | null {
  if (!tokens) return null;

  const total = readNonNegativeNumber(tokens.total);
  if (total !== null) return total;

  const cache = asRecord(tokens.cache);
  const input = readNonNegativeNumber(tokens.input) ?? 0;
  const output = readNonNegativeNumber(tokens.output) ?? 0;
  const reasoning = readNonNegativeNumber(tokens.reasoning) ?? 0;
  const cacheRead = readNonNegativeNumber(cache?.read) ?? 0;
  const cacheWrite = readNonNegativeNumber(cache?.write) ?? 0;
  const computedTotal = input + output + reasoning + cacheRead + cacheWrite;
  return computedTotal > 0 ? computedTotal : null;
}

function readCostTotal(value: unknown): number | null {
  const direct = readNonNegativeNumber(value);
  if (direct !== null) return direct;

  const record = asRecord(value);
  if (!record) return null;

  return readNonNegativeNumber(record.total ?? record.amount);
}

export function readOpenCodeUsageTelemetryFromMessageInfo(params: Readonly<{
  info: unknown;
  fallbackContextWindowTokens: number | null;
}>): { used: number; size: number; model: string | null; cost?: { total: number } } | null {
  const info = asRecord(params.info);
  if (!info) return null;
  if (normalizeString(info.role) !== 'assistant') return null;

  const tokens = asRecord(info.tokens);
  const used =
    readNonNegativeNumber(info.used) ??
    readUsageTotalTokens(tokens);

  const size =
    readContextWindowTokens(info.contextWindowTokens ?? info.contextWindow ?? info.context_window ?? info.size) ??
    params.fallbackContextWindowTokens;

  if (used === null || size === null) return null;

  const costTotal = readCostTotal(info.cost);
  return {
    used,
    size,
    model: readProviderModelId(info),
    ...(costTotal !== null ? { cost: { total: costTotal } } : {}),
  };
}
