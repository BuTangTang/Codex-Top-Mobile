import { describe, expect, it } from 'vitest';

import type { CurrentDaemonOwner } from '@/daemon/ownership/evaluateCurrentDaemonOwner';
import { resolveDaemonOwnershipConflictExitCode } from '@/daemon/ownership/resolveDaemonOwnershipConflictExitCode';

function buildOwner(overrides: Partial<CurrentDaemonOwner> = {}): CurrentDaemonOwner {
  return {
    status: 'running',
    source: 'state',
    state: {
      pid: 1,
      httpPort: 43111,
      startedAt: 1,
      startedWithCliVersion: '0.0.0-test',
      startedWithPublicReleaseChannel: 'preview',
      startupSource: 'background-service',
      serviceLabel: 'happier-daemon.preview',
    },
    currentCliVersion: '0.0.0-current',
    currentPublicReleaseChannel: 'preview',
    versionMatches: false,
    releaseChannelMatches: false,
    serviceManaged: true,
    startupSource: 'background-service',
    ...overrides,
  };
}

describe('resolveDaemonOwnershipConflictExitCode', () => {
  it('exits cleanly for background-service ownership conflicts to avoid restart storms', () => {
    expect(resolveDaemonOwnershipConflictExitCode('background-service', buildOwner())).toBe(0);
  });

  it('exits cleanly for background-service conflicts even when the current owner is not provably service-managed', () => {
    expect(resolveDaemonOwnershipConflictExitCode('background-service', buildOwner({ serviceManaged: false, startupSource: 'manual' }))).toBe(0);
    expect(resolveDaemonOwnershipConflictExitCode('background-service', buildOwner({ serviceManaged: null, startupSource: 'unknown' }))).toBe(0);
  });

  it('fails closed for non-service ownership conflicts', () => {
    expect(resolveDaemonOwnershipConflictExitCode('manual', buildOwner())).toBe(1);
    expect(resolveDaemonOwnershipConflictExitCode('self-restart', buildOwner())).toBe(1);
    expect(resolveDaemonOwnershipConflictExitCode('installer', buildOwner())).toBe(1);
    expect(resolveDaemonOwnershipConflictExitCode('unknown', buildOwner())).toBe(1);
  });
});
