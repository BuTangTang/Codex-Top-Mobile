import { describe, expect, it } from 'vitest';

import { resolveClaudeConfigDirForDirectSessions, resolveConfiguredClaudeConfigDir } from './resolveClaudeConfigDir';

describe('resolveClaudeConfigDirForDirectSessions', () => {
  it('uses env HOME for the default Claude config dir', () => {
    expect(resolveConfiguredClaudeConfigDir({
      env: {
        HOME: '/Users/tester',
      } satisfies NodeJS.ProcessEnv,
    })).toBe('/Users/tester/.claude');
  });

  it('expands ~/ source configDir against env HOME', () => {
    expect(resolveClaudeConfigDirForDirectSessions({
      source: {
        kind: 'claudeConfig',
        configDir: '~/team-claude',
      },
      env: {
        HOME: '/Users/tester',
      } satisfies NodeJS.ProcessEnv,
    })).toBe('/Users/tester/team-claude');
  });
});
