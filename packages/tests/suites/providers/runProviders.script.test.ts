import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as runProvidersScript from '../../scripts/run-providers.mjs';
import { parseArgs, resolveProvidersRunTimeoutFallbackMs, resolveProvidersRunTimeoutMs } from '../../scripts/run-providers.mjs';

type YarnInvocationResolver = (
  args: readonly string[],
  options?: Readonly<{ platform?: NodeJS.Platform; npmExecPath?: string; comspec?: string }>,
) => Readonly<{ command: string; args: string[]; windowsVerbatimArguments?: boolean }>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('providers run script args', () => {
  it('defaults flake retry to enabled', () => {
    const parsed = parseArgs(['node', 'run-providers.mjs', 'opencode', 'smoke']);

    expect(parsed.flakeRetry).toBe(true);
  });

  it('parses known flags and positional args', () => {
    const parsed = parseArgs([
      'node',
      'run-providers.mjs',
      'opencode',
      'smoke',
      '--update-baselines',
      '--strict-keys',
      '--flake-retry',
    ]);

    expect(parsed).toEqual({
      presetId: 'opencode',
      tier: 'smoke',
      updateBaselines: true,
      strictKeys: true,
      flakeRetry: true,
    });
  });

  it('allows explicit flake retry opt-out', () => {
    const parsed = parseArgs(['node', 'run-providers.mjs', 'opencode', 'smoke', '--no-flake-retry']);

    expect(parsed.flakeRetry).toBe(false);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['node', 'run-providers.mjs', 'opencode', 'smoke', '--bad-flag'])).toThrow(
      /Unknown flag/,
    );
  });

  it('rejects conflicting flake retry flags', () => {
    expect(() =>
      parseArgs(['node', 'run-providers.mjs', 'opencode', 'smoke', '--flake-retry', '--no-flake-retry']),
    ).toThrow(/Conflicting flags/);
  });

  it('rejects unexpected extra positional args', () => {
    expect(() => parseArgs(['node', 'run-providers.mjs', 'opencode', 'smoke', 'extra'])).toThrow(
      /Unexpected positional argument/,
    );
  });

  it('wraps the Windows Yarn shim through cmd.exe', () => {
    const resolveProviderRunYarnInvocation = (runProvidersScript as {
      resolveProviderRunYarnInvocation?: YarnInvocationResolver;
    }).resolveProviderRunYarnInvocation;

    expect(resolveProviderRunYarnInvocation).toBeTypeOf('function');
    if (!resolveProviderRunYarnInvocation) throw new Error('missing provider run Yarn invocation resolver');

    const invocation = resolveProviderRunYarnInvocation(['-s', 'test:providers'], {
      platform: 'win32',
      npmExecPath: 'C:\\npm\\node_modules\\npm\\bin\\npm-cli.js',
      comspec: 'C:\\Windows\\System32\\cmd.exe',
    });

    expect(invocation.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(invocation.windowsVerbatimArguments).toBe(true);
    expect(invocation.args.join(' ')).toContain('yarn.cmd');
    expect(invocation.args.join(' ')).not.toContain('npm-cli.js');
  });

  it('keeps the reusable providers workflow aligned with cursor preset support', () => {
    const workflow = readFileSync(resolve(repoRoot, '.github', 'workflows', 'tests.yml'), 'utf8');
    const providersContractsWorkflow = readFileSync(
      resolve(repoRoot, '.github', 'workflows', 'providers-contracts.yml'),
      'utf8',
    );
    const testsDispatchWorkflow = readFileSync(resolve(repoRoot, '.github', 'workflows', 'tests-dispatch.yml'), 'utf8');

    expect(workflow).toMatch(/case "\$PRESET" in[\s\S]*?\bcursor\)/);
    expect(workflow).toMatch(/\ball\)\s+need_claude=1;\s*need_codex=1;\s*need_opencode=1;\s*need_cursor=1\s*;;/);
    expect(workflow).toMatch(/CURSOR_API_KEY:\s+\$\{\{\s*secrets\.CURSOR_API_KEY\s*\}\}/);
    expect(workflow).toMatch(/\bcursor\)\s+need_cursor=1\s+;;/);
    expect(workflow).toMatch(/\ball\)\s+need_openai=1;\s*need_anthropic=1;\s*need_cursor=1\s*;;/);
    expect(workflow).toMatch(/Missing provider secrets: set CURSOR_API_KEY to run preset=\$PRESET/);
    expect(workflow).not.toMatch(/cursor\.com\/install[\s\S]*\|\s*bash/);
    expect(workflow).toMatch(/Cursor provider CI requires a preinstalled cursor-agent/);
    expect(providersContractsWorkflow).toMatch(/options:[\s\S]*?-\s+cursor/);
    expect(testsDispatchWorkflow).toMatch(/providers_preset:[\s\S]*?options:[\s\S]*?-\s+cursor/);
  });
});

describe('providers run script timeout', () => {
  it('uses bounded smoke fallback timeouts to guarantee terminalization', () => {
    expect(resolveProvidersRunTimeoutFallbackMs({ presetId: 'opencode', tier: 'smoke' })).toBe(20 * 60 * 1000);
    expect(resolveProvidersRunTimeoutFallbackMs({ presetId: 'all', tier: 'smoke' })).toBe(45 * 60 * 1000);
  });

  it('uses a longer default timeout for all:smoke than a single-provider smoke run', () => {
    const allSmoke = resolveProvidersRunTimeoutFallbackMs({ presetId: 'all', tier: 'smoke' });
    const oneSmoke = resolveProvidersRunTimeoutFallbackMs({ presetId: 'opencode', tier: 'smoke' });
    expect(allSmoke).toBeGreaterThan(oneSmoke);
  });

  it('uses fallback for missing/invalid values', () => {
    expect(resolveProvidersRunTimeoutMs(undefined, 123_000)).toBe(123_000);
    expect(resolveProvidersRunTimeoutMs('0', 123_000)).toBe(123_000);
    expect(resolveProvidersRunTimeoutMs('-50', 123_000)).toBe(123_000);
    expect(resolveProvidersRunTimeoutMs('not-a-number', 123_000)).toBe(123_000);
  });

  it('parses positive values and clamps minimum', () => {
    expect(resolveProvidersRunTimeoutMs('120000', 123_000)).toBe(120_000);
    expect(resolveProvidersRunTimeoutMs('1000', 123_000)).toBe(60_000);
  });
});
