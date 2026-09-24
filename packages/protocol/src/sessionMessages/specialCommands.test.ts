import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isNonSteerablePromptPayload,
  parseSpecialCommand,
} from './specialCommands.js';
import * as protocol from '../index.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

describe('session special command payload steerability', () => {
  it.each([
    { message: '/clear', expectedType: 'clear' },
    { message: '  /clear  ', expectedType: 'clear' },
    { message: '/compact', expectedType: 'compact' },
    { message: '/compact keep the summary', expectedType: 'compact' },
    { message: '/compact\tkeep the summary', expectedType: 'compact' },
    { message: '/compact\nkeep the summary', expectedType: 'compact' },
  ])('parses non-steerable Happier command "$message"', ({ message, expectedType }) => {
    expect(parseSpecialCommand(message).type).toBe(expectedType);
    expect(isNonSteerablePromptPayload(message)).toBe(true);
  });

  it.each([
    '/model',
    '/models',
    '/permissions',
    '/not-a-happier-command',
    'please run /compact later',
    'regular steering prompt',
  ])('treats non-Happier command text as steerable payload: %s', (message) => {
    expect(parseSpecialCommand(message).type).toBeNull();
    expect(isNonSteerablePromptPayload(message)).toBe(false);
  });

  it('exports the classifier from the protocol package root', () => {
    expect(protocol.isNonSteerablePromptPayload('/clear')).toBe(true);
    expect(protocol.isNonSteerablePromptPayload('/model')).toBe(false);
  });

  it.each([
    'apps/ui/sources/sync/domains/session/control/submitMode.ts',
    'apps/cli/src/agent/runtime/permission/bindPermissionModeQueue.ts',
    'apps/cli/src/backends/codex/runCodex.ts',
  ])('keeps %s on the shared payload classifier without a local command set', (relativePath) => {
    const source = readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');

    expect(source).toContain('isNonSteerablePromptPayload');
    expect(source).not.toContain("'/clear'");
    expect(source).not.toContain("'/compact'");
    expect(source).not.toContain('"/clear"');
    expect(source).not.toContain('"/compact"');
  });

  it('keeps the Claude arbiter steer gate on the shared payload classifier', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'apps/cli/src/backends/claude/unifiedTerminal/createClaudeUnifiedInputArbiter.ts'), 'utf8');

    expect(source).toContain('isNonSteerablePromptPayload');
    expect(source).not.toContain("startsWith('/')");
    expect(source).not.toContain('startsWith("/")');
  });

  it('keeps the CLI parser as a protocol re-export instead of a second command parser', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'apps/cli/src/cli/parsers/specialCommands.ts'), 'utf8');

    expect(source).toContain("from '@happier-dev/protocol'");
    expect(source).toContain('isNonSteerablePromptPayload');
    expect(source).not.toContain('function parse');
  });
});
