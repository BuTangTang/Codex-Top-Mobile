import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readBackendCliSourcePreference,
  resolveProviderCliCommand,
  resolveProviderCliCommandCandidates,
  resolveProviderCliManagedCommandPath,
} from './resolution';

describe('readBackendCliSourcePreference', () => {
  it('prefers target-keyed preferences from the env map', () => {
    expect(readBackendCliSourcePreference('codex', {
      HAPPIER_BACKEND_CLI_SOURCE_PREFERENCES_JSON: JSON.stringify({
        'agent:codex': 'managed-first',
        codex: 'system-first',
      }),
    } as NodeJS.ProcessEnv)).toBe('managed-first');
  });

  it('falls back to legacy id-keyed preferences when target-keyed entries are absent', () => {
    expect(readBackendCliSourcePreference('codex', {
      HAPPIER_BACKEND_CLI_SOURCE_PREFERENCES_JSON: JSON.stringify({
        codex: 'managed-first',
      }),
    } as NodeJS.ProcessEnv)).toBe('managed-first');
  });
});

describe('resolveProviderCliManagedCommandPath', () => {
  it('prefers a complete active managed release over the retained legacy current install on POSIX', () => {
    if (process.platform === 'win32') return;

    const root = mkdtempSync(join(tmpdir(), 'happier-provider-active-release-'));
    const happyHomeDir = join(root, 'home');
    const installRoot = join(happyHomeDir, 'tools', 'providers', 'codex');
    const activeReleaseDir = join(installRoot, '.releases', 'release-one');
    const activeCommandPath = join(activeReleaseDir, 'bin', 'codex');
    const legacyCommandPath = join(installRoot, 'current', 'bin', 'codex');
    try {
      mkdirSync(join(activeReleaseDir, 'bin'), { recursive: true });
      writeFileSync(activeCommandPath, '#!/bin/sh\nexit 0\n', 'utf8');
      chmodSync(activeCommandPath, 0o755);
      mkdirSync(join(installRoot, 'current', 'bin'), { recursive: true });
      writeFileSync(legacyCommandPath, '#!/bin/sh\nexit 0\n', 'utf8');
      chmodSync(legacyCommandPath, 0o755);
      symlinkSync(join('.releases', 'release-one'), join(installRoot, 'active'));

      expect(resolveProviderCliManagedCommandPath('codex', { happyHomeDir })).toBe(
        join(installRoot, 'active', 'bin', 'codex'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('resolveProviderCliCommandCandidates', () => {
  it('prefers stable opencode over opencode2 while keeping the explicit override authoritative', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'happier-opencode-v2-resolution-'));
    const stable = join(root, 'opencode');
    const beta = join(root, 'opencode2');
    try {
      for (const candidate of [stable, beta]) {
        writeFileSync(candidate, '#!/bin/sh\nexit 0\n', 'utf8');
        chmodSync(candidate, 0o755);
      }

      expect(resolveProviderCliCommand('opencode', {
        processEnv: { PATH: root, HOME: root },
      })).toEqual({ source: 'system', command: stable });
      expect(resolveProviderCliCommand('opencode', {
        processEnv: { PATH: root, HOME: root, HAPPIER_OPENCODE_PATH: beta },
      })).toEqual({ source: 'override', command: beta });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enumerates every distinct matching executable on PATH', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'happier-provider-path-candidates-'));
    const firstDir = join(root, 'first-bin');
    const secondDir = join(root, 'second-bin');
    mkdirSync(firstDir, { recursive: true });
    mkdirSync(secondDir, { recursive: true });
    const firstKimi = join(firstDir, 'kimi');
    const secondKimi = join(secondDir, 'kimi');
    try {
      for (const candidate of [firstKimi, secondKimi]) {
        writeFileSync(candidate, '#!/bin/sh\nexit 0\n', 'utf8');
        chmodSync(candidate, 0o755);
      }

      expect(resolveProviderCliCommandCandidates('kimi', {
        processEnv: { PATH: `${firstDir}:${secondDir}`, HOME: root },
      })).toEqual([
        { source: 'system', command: firstKimi },
        { source: 'system', command: secondKimi },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enumerates distinct PATH and known-location candidates without semver selection', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'happier-provider-candidates-'));
    const pathDir = join(root, 'path-bin');
    const homeDir = join(root, 'home');
    const knownDir = join(homeDir, '.local', 'bin');
    mkdirSync(pathDir, { recursive: true });
    mkdirSync(knownDir, { recursive: true });
    const pathKimi = join(pathDir, 'kimi');
    const knownKimi = join(knownDir, 'kimi');
    try {
      for (const candidate of [pathKimi, knownKimi]) {
        writeFileSync(candidate, '#!/bin/sh\nexit 0\n', 'utf8');
        chmodSync(candidate, 0o755);
      }

      expect(resolveProviderCliCommandCandidates('kimi', {
        processEnv: { PATH: pathDir, HOME: homeDir },
      })).toEqual([
        { source: 'system', command: pathKimi },
        { source: 'system', command: knownKimi },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('classifies only an explicit path when an override is configured', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'happier-provider-override-candidate-'));
    const explicit = join(root, 'kimi-explicit');
    try {
      writeFileSync(explicit, '#!/bin/sh\nexit 0\n', 'utf8');
      chmodSync(explicit, 0o755);
      expect(resolveProviderCliCommandCandidates('kimi', {
        processEnv: { PATH: '', HOME: root, HAPPIER_KIMI_PATH: explicit },
      })).toEqual([{ source: 'override', command: explicit }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
