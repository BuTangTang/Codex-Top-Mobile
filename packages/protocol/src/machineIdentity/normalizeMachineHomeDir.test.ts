import { describe, expect, it } from 'vitest';

import {
  compareMachineHomeDirs,
  normalizeMachineHomeDir,
} from './normalizeMachineHomeDir.js';

describe('normalizeMachineHomeDir', () => {
  it('expands both tilde separator forms against a caller supplied home base', () => {
    expect(normalizeMachineHomeDir('~/repo', { homeDir: '/Users/alice' })).toBe('/Users/alice/repo');
    expect(normalizeMachineHomeDir('~\\repo', { homeDir: '/Users/alice' })).toBe('/Users/alice/repo');
    expect(normalizeMachineHomeDir('~', { homeDir: '/Users/alice/' })).toBe('/Users/alice');
  });

  it('normalizes mixed and repeated separators without depending on process platform', () => {
    expect(normalizeMachineHomeDir('/Users//alice\\repo///', { platform: 'posix' })).toBe('/Users/alice/repo');
    expect(normalizeMachineHomeDir('C:/Users//Alice\\repo\\\\', { platform: 'win32' })).toBe('c:\\users\\alice\\repo');
  });

  it('infers Windows comparison for drive-letter paths and folds case', () => {
    expect(compareMachineHomeDirs('C:\\Users\\Alice', 'c:/users/alice/')).toBe(true);
  });

  it('trims trailing separators while preserving roots', () => {
    expect(normalizeMachineHomeDir('/Users/alice///', { platform: 'posix' })).toBe('/Users/alice');
    expect(normalizeMachineHomeDir('/', { platform: 'posix' })).toBe('/');
    expect(normalizeMachineHomeDir('C:\\', { platform: 'win32' })).toBe('c:\\');
  });

  it('does not collapse sibling-prefix homes into the same identity', () => {
    expect(compareMachineHomeDirs('/Users/alice', '/Users/alice2')).toBe(false);
    expect(compareMachineHomeDirs('C:\\Users\\alice', 'C:\\Users\\alice2', { platform: 'win32' })).toBe(false);
  });

  it('returns an empty identity for blank or unexpandable tilde inputs', () => {
    expect(normalizeMachineHomeDir(null)).toBe('');
    expect(normalizeMachineHomeDir('   ')).toBe('');
    expect(normalizeMachineHomeDir('~/repo')).toBe('');
    expect(compareMachineHomeDirs('~/repo', '/Users/alice/repo')).toBe(false);
  });
});
