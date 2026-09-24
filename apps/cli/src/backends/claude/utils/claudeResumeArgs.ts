export function readExplicitClaudeResumeSessionIdFromArgs(
  args: readonly string[] | null | undefined,
): string | null {
  for (let i = 0; i < (args?.length ?? 0); i++) {
    const arg = args?.[i];
    if (arg !== '--resume' && arg !== '-r') continue;

    const value = args?.[i + 1];
    if (typeof value !== 'string' || value.startsWith('-')) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}
