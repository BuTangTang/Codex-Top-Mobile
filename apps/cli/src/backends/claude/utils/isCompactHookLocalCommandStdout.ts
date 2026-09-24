function firstClaudeMessageText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = (value as Record<string, unknown>).message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const text = (item as Record<string, unknown>).text;
    if (typeof text === 'string') return text;
  }
  return null;
}

function stripAnsiControlSequences(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

export function isCompactHookLocalCommandStdout(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const text = firstClaudeMessageText(value);
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith('<local-command-stdout>')) return false;
  return /\b(?:PreCompact|PostCompact)\b/.test(stripAnsiControlSequences(trimmed));
}
