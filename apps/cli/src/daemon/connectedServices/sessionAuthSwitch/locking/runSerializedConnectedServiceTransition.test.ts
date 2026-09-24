import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { ConnectedServiceSessionAuthSwitchCore } from '../../runtimeAuth/connectedServiceSessionAuthSwitchCore';
import { runSerializedConnectedServiceTransition } from './runSerializedConnectedServiceTransition';

const sessionAuthSwitchDir = fileURLToPath(new URL('..', import.meta.url));

function listProductionSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listProductionSourceFiles(fullPath);
    if (!entry.isFile()) return [];
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [fullPath];
  });
}

describe('runSerializedConnectedServiceTransition', () => {
  it('does not let a legacy boolean skip the session transition lock', async () => {
    const calls: string[] = [];
    const core: ConnectedServiceSessionAuthSwitchCore = {
      async run({ execute }) {
        calls.push('lock');
        return await execute();
      },
      clearSession() {},
    };
    const input = {
      core,
      sessionId: 'sess_1',
      reason: 'manual' as const,
      skipCoreLock: true,
      execute: async () => 'done',
    };

    await expect(runSerializedConnectedServiceTransition(input)).resolves.toBe('done');

    expect(calls).toEqual(['lock']);
  });

  it('allows only explicit test-only mode to bypass the session transition lock', async () => {
    const calls: string[] = [];
    const core: ConnectedServiceSessionAuthSwitchCore = {
      async run() {
        calls.push('lock');
        throw new Error('test-only mode should bypass the core lock');
      },
      clearSession() {},
    };
    const input = {
      core,
      sessionId: 'sess_1',
      reason: 'automatic_runtime_failure' as const,
      transitionLockMode: {
        kind: 'test_only_unlocked' as const,
        reason: 'unit test controls serialization directly',
      },
      execute: async () => 'done',
    };

    await expect(runSerializedConnectedServiceTransition(input)).resolves.toBe('done');

    expect(calls).toEqual([]);
  });

  it('rejects fabricated production group lease bypass data', async () => {
    const calls: string[] = [];
    const core: ConnectedServiceSessionAuthSwitchCore = {
      async run({ execute }) {
        calls.push('lock');
        return await execute();
      },
      clearSession() {},
    };
    const input = {
      core,
      sessionId: 'sess_1',
      reason: 'automatic_runtime_failure' as const,
      transitionLockMode: {
        kind: 'already_holds_group_lease' as const,
        leaseId: 'fabricated-lease-id',
        owner: 'ConnectedServiceAuthGroupSwitchCoordinator' as const,
      },
      execute: async () => 'done',
    } as unknown as Parameters<typeof runSerializedConnectedServiceTransition>[0];

    await expect(runSerializedConnectedServiceTransition(input)).rejects.toThrow(
      'verified connected service transition lock mode is required',
    );

    expect(calls).toEqual([]);
  });

  it('keeps production session-auth switch code free of legacy lock bypass contracts', () => {
    const offenders = listProductionSourceFiles(sessionAuthSwitchDir)
      .flatMap((filePath) => {
        const source = readFileSync(filePath, 'utf8');
        return [
          source.includes('skipCoreLock') ? 'skipCoreLock' : null,
          source.includes('already_holds_group_lease') ? 'already_holds_group_lease' : null,
        ]
          .filter((token): token is string => token !== null)
          .map((token) => `${relative(sessionAuthSwitchDir, filePath)}:${token}`);
      });

    expect(offenders).toEqual([]);
  });
});
