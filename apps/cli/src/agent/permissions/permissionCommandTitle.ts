const GENERIC_EXECUTE_TITLE_LABELS = new Set([
  'execute',
  'shell',
  'bash',
  'run shell command',
  'run terminal command',
  'run command',
  'execute shell command',
  'execute terminal command',
  'execute command',
]);

function normalizeTitleLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function isGenericExecuteTitle(value: string): boolean {
  return GENERIC_EXECUTE_TITLE_LABELS.has(normalizeTitleLabel(value));
}

export function extractCommandFromExecuteTitle(value: string): string | null {
  const title = value.trim();
  if (!title || isGenericExecuteTitle(title)) return null;

  const prefixed = title.match(/^(shell|bash|execute|run shell command|run terminal command|run command|execute shell command|execute terminal command|execute command)\s*:\s*(.+)$/i);
  const stripped = prefixed?.[2]?.trim();
  return stripped && !isGenericExecuteTitle(stripped) ? stripped : title;
}
