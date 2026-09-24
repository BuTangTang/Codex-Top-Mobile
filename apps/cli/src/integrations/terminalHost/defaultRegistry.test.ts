import { describe, expect, it, vi } from 'vitest';

const createZellijTerminalHostAdapter = vi.hoisted(() => vi.fn(() => ({ kind: 'zellij' })));

vi.mock('@/configuration', () => ({
  configuration: {
    happyHomeDir: '/home/happier',
    claudeUnifiedTerminalHostActionTimeoutMs: 15_000,
  },
}));
vi.mock('@/integrations/tmux', () => ({
  createTmuxTerminalHostAdapter: () => ({ kind: 'tmux' }),
}));
vi.mock('@/integrations/zellij/adapter', () => ({
  DEFAULT_ZELLIJ_STARTUP_ACTION_TIMEOUT_MS: 60_000,
  createZellijTerminalHostAdapter,
}));
vi.mock('@/integrations/zellij/runtimeBinary', () => ({
  resolveZellijRuntimeBinary: async () => '/tools/zellij',
}));
vi.mock('./registry', () => ({
  createTerminalHostRegistry: (adapters: unknown) => adapters,
}));

import { createDefaultTerminalHostRegistry } from './defaultRegistry';

describe('createDefaultTerminalHostRegistry', () => {
  it('does not let the routine action timeout undercut Zellij startup', async () => {
    await createDefaultTerminalHostRegistry();

    expect(createZellijTerminalHostAdapter).toHaveBeenCalledWith(expect.objectContaining({
      actionTimeoutMs: 15_000,
      startupActionTimeoutMs: 60_000,
    }));
  });
});
