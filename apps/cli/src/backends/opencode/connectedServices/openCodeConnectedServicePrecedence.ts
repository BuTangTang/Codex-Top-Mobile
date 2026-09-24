export const OPEN_CODE_CONNECTED_SERVICE_PRECEDENCE = [
  'openai-codex',
  'openai',
  'claude-subscription',
  'anthropic',
] as const;

export type OpenCodeConnectedServiceId = typeof OPEN_CODE_CONNECTED_SERVICE_PRECEDENCE[number];

function readRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readOpenCodeConnectedServiceId(value: unknown): OpenCodeConnectedServiceId | null {
  const normalized = readString(value);
  if (!normalized) return null;
  return (OPEN_CODE_CONNECTED_SERVICE_PRECEDENCE as readonly string[]).includes(normalized)
    ? normalized as OpenCodeConnectedServiceId
    : null;
}

export function findOpenCodeConnectedServiceSelection(
  selections: readonly unknown[],
  serviceId: OpenCodeConnectedServiceId,
): unknown | null {
  return selections.find((selection) => readOpenCodeConnectedServiceId(readRecord(selection)?.serviceId) === serviceId) ?? null;
}

export function resolveOpenCodeConnectedServiceSelectionByPrecedence(
  selections: readonly unknown[],
): unknown | null {
  for (const serviceId of OPEN_CODE_CONNECTED_SERVICE_PRECEDENCE) {
    const match = findOpenCodeConnectedServiceSelection(selections, serviceId);
    if (match) return match;
  }
  return null;
}
