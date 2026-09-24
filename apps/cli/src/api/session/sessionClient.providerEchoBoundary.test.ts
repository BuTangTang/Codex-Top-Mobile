import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('ApiSessionClient provider echo boundary', () => {
  it('does not own Claude local-id echo classification', () => {
    const source = readFileSync(new URL('./sessionClient.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('CLAUDE_JSONL_LOCAL_ID_PREFIX');
    expect(source).not.toContain('isProviderOwnedUserMessageEchoFromUpdate');
  });
});
