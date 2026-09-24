import { describe, expect, it } from 'vitest';

import { extractClaudeTerminalInitialPrompt } from './terminalInitialPrompt';

describe('extractClaudeTerminalInitialPrompt', () => {
  it('extracts positional CLI prompts while preserving provider flags', () => {
    expect(extractClaudeTerminalInitialPrompt([
      '--verbose',
      'fix the bug in main.ts',
      '--model',
      'opus',
      '--effort',
      'high',
    ])).toEqual({
      prompt: 'fix the bug in main.ts',
      claudeArgs: ['--verbose', '--model', 'opus', '--effort', 'high'],
    });
  });

  it('converts Claude print prompt flags into terminal-injected prompts', () => {
    expect(extractClaudeTerminalInitialPrompt([
      '-p',
      'HELLO_FROM_PRINT_FLAG',
      '--model',
      'sonnet',
    ])).toEqual({
      prompt: 'HELLO_FROM_PRINT_FLAG',
      claudeArgs: ['--model', 'sonnet'],
    });

    expect(extractClaudeTerminalInitialPrompt([
      '--print=HELLO_FROM_PRINT_EQUALS',
      '--fallback-model',
      'haiku',
    ])).toEqual({
      prompt: 'HELLO_FROM_PRINT_EQUALS',
      claudeArgs: ['--fallback-model', 'haiku'],
    });
  });

  it('treats tokens after -- as prompt text and strips the delimiter from provider args', () => {
    expect(extractClaudeTerminalInitialPrompt([
      '--mcp-config',
      '/tmp/user-mcp.json',
      '--',
      'write',
      '--literal-flag',
      'content',
    ])).toEqual({
      prompt: 'write --literal-flag content',
      claudeArgs: ['--mcp-config', '/tmp/user-mcp.json'],
    });
  });

  it('preserves Claude option values before extracting the positional prompt', () => {
    expect(extractClaudeTerminalInitialPrompt([
      '--name',
      'D8 CLI startup fix',
      'D8_CLI_STARTUP_FIX prompt',
    ])).toEqual({
      prompt: 'D8_CLI_STARTUP_FIX prompt',
      claudeArgs: ['--name', 'D8 CLI startup fix'],
    });
  });
});
