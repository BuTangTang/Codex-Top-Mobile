import { describe, expect, it } from 'vitest';

import { isCompactHookLocalCommandStdout } from './isCompactHookLocalCommandStdout';

describe('isCompactHookLocalCommandStdout', () => {
  it('recognizes compact hook stdout when Claude wraps hook names in ANSI SGR escapes', () => {
    expect(isCompactHookLocalCommandStdout({
      type: 'user',
      uuid: 'compact-stdout-ansi',
      message: {
        role: 'user',
        content:
          '<local-command-stdout>\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m\n' +
          "\u001b[2mPreCompact [python3 '/Users/leeroy/.claude/hooks/claude-island-state.py'] completed successfully\u001b[22m\n" +
          "\u001b[2mPostCompact [python3 '/Users/leeroy/.claude/hooks/claude-island-state.py'] completed successfully\u001b[22m</local-command-stdout>",
      },
    })).toBe(true);
  });
});
