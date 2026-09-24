import { describe, expect, it, vi } from 'vitest';

const {
  handleServiceRepairCliCommandMock,
  runDaemonServiceCliCommandMock,
} = vi.hoisted(() => ({
  handleServiceRepairCliCommandMock: vi.fn(async () => undefined),
  runDaemonServiceCliCommandMock: vi.fn(async () => undefined),
}));

vi.mock('@/daemon/service/cli', () => ({
  runDaemonServiceCliCommand: runDaemonServiceCliCommandMock,
}));

vi.mock('./serviceRepair/handleServiceRepairCliCommand', () => ({
  handleServiceRepairCliCommand: handleServiceRepairCliCommandMock,
}));

vi.mock('@/cli/runtime/resolveInvokerName', () => ({
  resolveInvokerName: () => 'happier',
}));

import { handleServiceCliCommand } from './service';

describe('service command routing', () => {
  it('routes top-level service actions through the daemon service CLI', async () => {
    await handleServiceCliCommand({
      args: ['service', 'install', '--json'],
      rawArgv: ['node', 'happier', 'service', 'install', '--json'],
      terminalRuntime: null,
    });

    expect(runDaemonServiceCliCommandMock).toHaveBeenCalledWith({
      argv: ['install', '--json'],
      commandPath: 'happier service',
    });
  });

  it('routes service repair through the bounded repair command handler', async () => {
    await handleServiceCliCommand({
      args: ['service', 'repair', '--json'],
      rawArgv: ['node', 'happier', 'service', 'repair', '--json'],
      terminalRuntime: null,
    });

    expect(handleServiceRepairCliCommandMock).toHaveBeenCalledWith({
      argv: ['repair', '--json'],
      commandPath: 'happier service',
    });
    expect(runDaemonServiceCliCommandMock).not.toHaveBeenCalledWith({
      argv: ['repair', '--json'],
    });
  });
});
