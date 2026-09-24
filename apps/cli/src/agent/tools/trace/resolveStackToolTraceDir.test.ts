import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { resolveStackToolTraceDir } from './resolveStackToolTraceDir';

describe('resolveStackToolTraceDir', () => {
  it('defaults to ~/.happier/stacks/<stack>/cli/tool-traces', () => {
    const stack = 'unit-test-stack';
    const dir = resolveStackToolTraceDir({ stack, env: {} });
    expect(dir).toBe(path.join(os.homedir(), '.happier', 'stacks', stack, 'cli', 'tool-traces'));
  });

  it('defaults to HAPPIER_HOME_DIR/stacks when HAPPIER_HOME_DIR is configured', () => {
    const stack = 'unit-test-stack';
    const dir = resolveStackToolTraceDir({
      stack,
      env: {
        HAPPIER_HOME_DIR: '/scoped/happier-home',
      },
    });
    expect(dir).toBe(path.join('/scoped/happier-home', 'stacks', stack, 'cli', 'tool-traces'));
  });

  it('respects HAPPIER_STACK_STORAGE_DIR override', () => {
    const storage = mkdtempSync(path.join(tmpdir(), 'happier-stack-storage-'));
    const stack = 'unit-test-stack';
    const dir = resolveStackToolTraceDir({ stack, env: { HAPPIER_STACK_STORAGE_DIR: storage } });
    expect(dir).toBe(path.join(storage, stack, 'cli', 'tool-traces'));
  });

  it('expands Windows-style home shorthand in HAPPIER_STACK_STORAGE_DIR overrides', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'happier-stack-storage-home-'));
    const homeDir = path.join(root, 'home');
    const stack = 'unit-test-stack';
    const dir = resolveStackToolTraceDir({
      stack,
      env: {
        HOME: homeDir,
        USERPROFILE: homeDir,
        HAPPIER_STACK_STORAGE_DIR: '~\\stack-root',
      },
    });
    expect(dir).toBe(path.join(homeDir, 'stack-root', stack, 'cli', 'tool-traces'));
  });

  it('rejects stack names containing path separators', () => {
    expect(() => resolveStackToolTraceDir({ stack: 'bad/stack', env: {} })).toThrow(/stack/i);
    expect(() => resolveStackToolTraceDir({ stack: 'bad\\stack', env: {} })).toThrow(/stack/i);
  });

  it('rejects stack names containing path traversal segments', () => {
    expect(() => resolveStackToolTraceDir({ stack: '../escape', env: {} })).toThrow(/stack/i);
    expect(() => resolveStackToolTraceDir({ stack: 'escape/../x', env: {} })).toThrow(/stack/i);
  });
});
