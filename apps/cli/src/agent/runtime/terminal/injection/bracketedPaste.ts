// Adapted from generalaction/emdash src/shared/prompt-injection.ts
// © 2026 General Action, Inc. Apache-2.0

export const BRACKETED_PASTE_START = '\x1b[200~';
export const BRACKETED_PASTE_END = '\x1b[201~';

export function wrapBracketedPaste(text: string): string {
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
}

export function hasMultilinePayload(text: string): boolean {
  return text.includes('\n') || text.includes('\r');
}
