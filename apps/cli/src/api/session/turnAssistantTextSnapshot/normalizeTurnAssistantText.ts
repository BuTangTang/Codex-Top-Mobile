export function normalizeTurnAssistantText(
  value: string | null | undefined,
  params: Readonly<{ maxTextChars: number }>,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;
  const maxTextChars = Math.max(1, Math.trunc(params.maxTextChars));
  return normalized.length > maxTextChars ? normalized.slice(0, maxTextChars) : normalized;
}
