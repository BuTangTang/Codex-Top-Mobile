import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';

const ensureAgentInstallablesBackground = vi.fn(async (_args: unknown) => {});
const getActiveServerSnapshot = vi.fn(() => ({ serverId: 'server-a' }));
const storageGetState = vi.fn<() => any>();

vi.mock('@/capabilities/ensureAgentInstallablesBackground', () => ({
  ensureAgentInstallablesBackground: (args: unknown) => ensureAgentInstallablesBackground(args),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: () => getActiveServerSnapshot(),
}));

vi.mock('@/sync/domains/state/storage', () => createStorageModuleStub({
  storage: {
    getState: () => storageGetState(),
  } as any,
}));

describe('ensureVoiceAgentInstallablesBackground', () => {
  beforeEach(() => {
    ensureAgentInstallablesBackground.mockReset();
    getActiveServerSnapshot.mockReset();
    getActiveServerSnapshot.mockReturnValue({ serverId: 'server-a' });
    storageGetState.mockReset();
  });

  it('uses the resolved session machine target instead of stale session metadata', async () => {
    storageGetState.mockReturnValue({
      settings: { voice: { adapters: { local_conversation: {} } } },
      sessions: {
        s1: {
          id: 's1',
          active: false,
          metadata: { machineId: 'machine-stale', path: '/tmp/stale' },
        },
      },
      machines: {
        'machine-stale': {
          id: 'machine-stale',
          active: false,
          activeAt: 1,
          metadata: { host: 'stale.local' },
          replacedByMachineId: 'machine-target',
          replacedAt: 2,
        },
        'machine-target': {
          id: 'machine-target',
          active: true,
          activeAt: 3,
          metadata: { host: 'target.local' },
        },
      },
      getProjectForSession: (sessionId: string) =>
        sessionId === 's1'
          ? { key: { machineId: 'machine-target', path: '/tmp/target' } }
          : null,
    });

    const { ensureVoiceAgentInstallablesBackground } = await import('./ensureVoiceAgentInstallablesBackground');

    await ensureVoiceAgentInstallablesBackground({ agentId: 'claude', sessionId: 's1' });

    expect(ensureAgentInstallablesBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'claude',
        machineId: 'machine-target',
        serverId: 'server-a',
        resumeSessionId: 's1',
      }),
    );
  });
});
