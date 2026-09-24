import { describe, expect, it } from 'vitest';

import {
  CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE,
  CLAUDE_CODE_REQUIRED_OAUTH_SCOPES,
  findMissingClaudeCodeCredentialScopes,
  parseClaudeCodeCredentialScopes,
} from './claudeCodeCredentialScopes';

describe('claudeCodeCredentialScopes', () => {
  it('defines the Claude Code session scope required by Claude Unified', () => {
    expect(CLAUDE_CODE_REQUIRED_OAUTH_SCOPES).toContain('user:sessions:claude_code');
    expect(CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE).toContain('user:sessions:claude_code');
  });

  it('parses space-delimited and array scopes with stable de-duplication', () => {
    expect(parseClaudeCodeCredentialScopes(' user:profile  user:inference user:profile ')).toEqual([
      'user:profile',
      'user:inference',
    ]);
    expect(parseClaudeCodeCredentialScopes(['user:mcp_servers', ' user:mcp_servers ', ''])).toEqual([
      'user:mcp_servers',
    ]);
  });

  it('returns missing required Claude Code scopes', () => {
    expect(findMissingClaudeCodeCredentialScopes('user:profile user:inference')).toEqual([
      'user:sessions:claude_code',
    ]);
    expect(findMissingClaudeCodeCredentialScopes(CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE)).toEqual([]);
  });
});
