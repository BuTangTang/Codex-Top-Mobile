function normalizeReasoningEffortValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function adoptReasoningEffortOverrideFromMessageMeta(opts: Readonly<{
  currentValueId: string | null;
  currentUpdatedAt: number;
  messageMeta: Record<string, unknown> | null | undefined;
  updatedAt: number;
}>): { valueId: string | null; updatedAt: number; didChange: boolean } {
  const meta = opts.messageMeta;
  if (!meta) {
    return { valueId: opts.currentValueId, updatedAt: opts.currentUpdatedAt, didChange: false };
  }

  const hasCamelCase = Object.prototype.hasOwnProperty.call(meta, 'reasoningEffort');
  const hasSnakeCase = Object.prototype.hasOwnProperty.call(meta, 'reasoning_effort');
  if (!hasCamelCase && !hasSnakeCase) {
    return { valueId: opts.currentValueId, updatedAt: opts.currentUpdatedAt, didChange: false };
  }

  const rawValue = hasCamelCase ? meta.reasoningEffort : meta.reasoning_effort;
  const valueId = normalizeReasoningEffortValue(rawValue);
  if (!valueId || opts.updatedAt <= opts.currentUpdatedAt) {
    return { valueId: opts.currentValueId, updatedAt: opts.currentUpdatedAt, didChange: false };
  }

  return { valueId, updatedAt: opts.updatedAt, didChange: true };
}
