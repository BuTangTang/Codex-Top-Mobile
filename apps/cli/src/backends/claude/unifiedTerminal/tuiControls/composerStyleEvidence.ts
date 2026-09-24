import { stripTerminalControlSequences } from '@/integrations/terminalHost/controlCapture';

export const SGR_SEQUENCE_PREFIX = '\x1b[';

function readRawComposerLinesForContent(rawText: string, content: string): string[] {
  if (content.length === 0) return [];
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
  const matches: string[] = [];
  for (const rawLine of lines) {
    const stripped = stripTerminalControlSequences(rawLine);
    if (!/[>›❯]/u.test(stripped)) continue;
    if (!stripped.includes(content)) continue;
    matches.push(rawLine);
  }
  return matches;
}

export function hasComposerLineStyleEvidence(rawText: string, content: string): boolean {
  return readRawComposerLinesForContent(rawText, content)
    .some((line) => line.includes(SGR_SEQUENCE_PREFIX));
}
