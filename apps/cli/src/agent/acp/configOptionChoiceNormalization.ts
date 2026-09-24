function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeAcpConfigOptionChoices<TValue>(
  rawOptions: unknown,
  normalizeValue: (value: unknown) => TValue | null,
): Array<{ value: TValue; name: string; description?: string }> {
  if (!Array.isArray(rawOptions)) return [];

  const out: Array<{ value: TValue; name: string; description?: string }> = [];
  const visit = (entries: ReadonlyArray<unknown>): void => {
    for (const rawEntry of entries) {
      const entry = asRecord(rawEntry);
      if (!entry) continue;

      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const value = normalizeValue(entry.value);
      if (value !== null && name) {
        const description = typeof entry.description === 'string' ? entry.description.trim() : '';
        out.push({ value, name, ...(description ? { description } : {}) });
      }

      if (Array.isArray(entry.options)) {
        visit(entry.options);
      }
    }
  };

  visit(rawOptions);
  return out;
}

export function isAcpModelConfigOptionLike(value: {
  id?: unknown;
  name?: unknown;
  category?: unknown;
}): boolean {
  const id = typeof value.id === 'string' ? value.id.trim().toLowerCase() : '';
  const name = typeof value.name === 'string' ? value.name.trim().toLowerCase() : '';
  const category = typeof value.category === 'string' ? value.category.trim().toLowerCase() : '';
  return category === 'model' || id === 'model' || name === 'model';
}

export function isAcpModeConfigOptionLike(value: {
  id?: unknown;
  name?: unknown;
  category?: unknown;
}): boolean {
  const id = typeof value.id === 'string' ? value.id.trim().toLowerCase() : '';
  const name = typeof value.name === 'string' ? value.name.trim().toLowerCase() : '';
  const category = typeof value.category === 'string' ? value.category.trim().toLowerCase() : '';
  return category === 'mode' || id === 'mode' || name === 'mode';
}
