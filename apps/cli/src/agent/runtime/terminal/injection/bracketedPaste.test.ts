import { describe, expect, it } from 'vitest';

import { BRACKETED_PASTE_END, BRACKETED_PASTE_START, hasMultilinePayload, wrapBracketedPaste } from './bracketedPaste';

describe('bracketedPaste', () => {
  it('detects multiline payloads', () => {
    expect(hasMultilinePayload('line one\nline two')).toBe(true);
    expect(hasMultilinePayload('line one\rline two')).toBe(true);
  });

  it('does not treat single-line prompts as multiline payloads', () => {
    expect(hasMultilinePayload('one line')).toBe(false);
  });

  it('wraps payloads with standard bracketed paste markers', () => {
    expect(wrapBracketedPaste('hello')).toBe(`${BRACKETED_PASTE_START}hello${BRACKETED_PASTE_END}`);
  });
});
