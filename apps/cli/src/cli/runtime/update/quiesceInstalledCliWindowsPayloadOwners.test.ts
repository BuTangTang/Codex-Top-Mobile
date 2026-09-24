import { afterEach, describe, expect, it, vi } from 'vitest';

const originalPlatformDescriptor: PropertyDescriptor = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!descriptor) {
    throw new Error('process.platform descriptor is required for this test');
  }
  return descriptor;
})();

const {
  existsSyncMock,
  findAllHappyProcessesMock,
  resolveInstalledFirstPartyComponentPathsMock,
  spawnSyncMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn((value: unknown) => String(value).includes('hdev.exe')),
  findAllHappyProcessesMock: vi.fn(),
  resolveInstalledFirstPartyComponentPathsMock: vi.fn((_params?: unknown) => ({
    installRoot: 'C:\\Users\\tester\\.happier\\cli-dev',
    currentPath: 'C:\\Users\\tester\\.happier\\cli-dev\\current',
    previousPath: 'C:\\Users\\tester\\.happier\\cli-dev\\previous',
    versionsDir: 'C:\\Users\\tester\\.happier\\cli-dev\\versions',
    binaryPath: 'C:\\Users\\tester\\.happier\\cli-dev\\current\\happier.exe',
    nodeEntrypointPath: 'C:\\Users\\tester\\.happier\\cli-dev\\current\\package-dist\\index.mjs',
    shimPaths: ['C:\\Users\\tester\\.happier\\bin\\hdev.exe'],
  })),
  spawnSyncMock: vi.fn((_command?: unknown, _args?: unknown, _options?: unknown) => ({ status: 0 })),
}));

vi.mock('node:fs', () => ({
  existsSync: (value: unknown) => existsSyncMock(value),
}));

vi.mock('cross-spawn', () => ({
  default: {
    sync: (command: unknown, args: unknown, options: unknown) => spawnSyncMock(command, args, options),
  },
}));

vi.mock('@happier-dev/cli-common/firstPartyRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/cli-common/firstPartyRuntime')>();
  return {
    ...actual,
    resolveInstalledFirstPartyComponentPaths: (...args: unknown[]) =>
      resolveInstalledFirstPartyComponentPathsMock(args[0]),
  };
});

vi.mock('@/daemon/doctor', () => ({
  findAllHappyProcesses: () => findAllHappyProcessesMock(),
}));

async function withPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor, value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor });
  }
}

describe('quiesceInstalledCliWindowsPayloadOwners', () => {
  afterEach(() => {
    existsSyncMock.mockClear();
    existsSyncMock.mockImplementation((value: unknown) => String(value).includes('hdev.exe'));
    findAllHappyProcessesMock.mockReset();
    resolveInstalledFirstPartyComponentPathsMock.mockClear();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockImplementation(() => ({ status: 0 }));
    vi.restoreAllMocks();
  });

  it('is a no-op outside Windows', async () => {
    await withPlatform('linux', async () => {
      const { quiesceInstalledCliWindowsPayloadOwners } = await import('./quiesceInstalledCliWindowsPayloadOwners');
      await quiesceInstalledCliWindowsPayloadOwners({
        channel: 'publicdev',
        processEnv: { ...process.env, HAPPIER_HOME_DIR: '/tmp/home' },
      });
    });

    expect(resolveInstalledFirstPartyComponentPathsMock).not.toHaveBeenCalled();
    expect(findAllHappyProcessesMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('stops and force-kills same-home daemon-owned processes before payload promotion', async () => {
    findAllHappyProcessesMock
      .mockResolvedValueOnce([
        {
          pid: 11,
          command: '"C:\\Users\\tester\\.happier\\bin\\hdev.exe" daemon start-sync',
          type: 'daemon',
        },
        {
          pid: 12,
          command:
            'C:\\Users\\tester\\.happier\\bin\\hdev.exe C:\\Users\\tester\\.happier\\cli-dev\\current\\package-dist\\index.mjs codex --happy-starting-mode remote --started-by daemon',
          type: 'daemon-spawned-session',
        },
        {
          pid: 13,
          command: '"C:\\Users\\tester\\.other-home\\bin\\hdev.exe" daemon start-sync',
          type: 'daemon',
        },
        {
          pid: 14,
          command: '"C:\\Users\\tester\\.happier\\bin\\hdev.exe" auth status --json',
          type: 'user-session',
        },
      ])
      .mockResolvedValueOnce([]);

    await withPlatform('win32', async () => {
      const { quiesceInstalledCliWindowsPayloadOwners } = await import('./quiesceInstalledCliWindowsPayloadOwners');
      await quiesceInstalledCliWindowsPayloadOwners({
        channel: 'publicdev',
        processEnv: { ...process.env, HAPPIER_HOME_DIR: 'C:\\Users\\tester\\.happier' },
      });
    });

    expect(resolveInstalledFirstPartyComponentPathsMock).toHaveBeenCalledWith({
      componentId: 'happier-cli',
      channel: 'publicdev',
      processEnv: expect.objectContaining({
        HAPPIER_HOME_DIR: 'C:\\Users\\tester\\.happier',
      }),
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      'C:\\Users\\tester\\.happier\\bin\\hdev.exe',
      ['service', 'stop', '--json'],
      expect.objectContaining({
        env: expect.objectContaining({
          HAPPIER_HOME_DIR: 'C:\\Users\\tester\\.happier',
        }),
        stdio: 'ignore',
        windowsHide: true,
      }),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      'C:\\Users\\tester\\.happier\\bin\\hdev.exe',
      ['daemon', 'stop', '--all', '--kill-sessions', '--json'],
      expect.objectContaining({
        env: expect.objectContaining({
          HAPPIER_HOME_DIR: 'C:\\Users\\tester\\.happier',
        }),
        stdio: 'ignore',
        windowsHide: true,
      }),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      3,
      'taskkill',
      ['/F', '/T', '/PID', '11'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true }),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      4,
      'taskkill',
      ['/F', '/T', '/PID', '12'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true }),
    );
    expect(spawnSyncMock).toHaveBeenCalledTimes(4);
  });

  it('bounds installed CLI stop commands during installer-driven payload promotion', async () => {
    findAllHappyProcessesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await withPlatform('win32', async () => {
      const { quiesceInstalledCliWindowsPayloadOwners } = await import('./quiesceInstalledCliWindowsPayloadOwners');
      await quiesceInstalledCliWindowsPayloadOwners({
        channel: 'publicdev',
        processEnv: {
          ...process.env,
          HAPPIER_HOME_DIR: 'C:\\Users\\tester\\.happier',
          HAPPIER_INSTALLER_PRE_INSTALL_COMMAND_TIMEOUT_MS: '7000',
        },
      });
    });

    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      'C:\\Users\\tester\\.happier\\bin\\hdev.exe',
      ['service', 'stop', '--json'],
      expect.objectContaining({
        timeout: 7000,
        stdio: 'ignore',
        windowsHide: true,
      }),
    );
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      'C:\\Users\\tester\\.happier\\bin\\hdev.exe',
      ['daemon', 'stop', '--all', '--kill-sessions', '--json'],
      expect.objectContaining({
        timeout: 7000,
        stdio: 'ignore',
        windowsHide: true,
      }),
    );
  });

  it('skips redundant installed CLI stop commands when installer pre-install cleanup already ran', async () => {
    findAllHappyProcessesMock
      .mockResolvedValueOnce([
        {
          pid: 31,
          command: '"C:\\Users\\tester\\.happier\\bin\\hdev.exe" daemon start-sync',
          type: 'daemon',
        },
      ])
      .mockResolvedValueOnce([]);

    await withPlatform('win32', async () => {
      const { quiesceInstalledCliWindowsPayloadOwners } = await import('./quiesceInstalledCliWindowsPayloadOwners');
      await quiesceInstalledCliWindowsPayloadOwners({
        channel: 'publicdev',
        processEnv: {
          ...process.env,
          HAPPIER_HOME_DIR: 'C:\\Users\\tester\\.happier',
          HAPPIER_CLI_SKIP_PAYLOAD_OWNER_STOP_COMMANDS: '1',
        },
      });
    });

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'taskkill',
      ['/F', '/T', '/PID', '31'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true }),
    );
  });

  it('throws when same-home daemon-owned processes remain after force-kill', async () => {
    findAllHappyProcessesMock
      .mockResolvedValueOnce([
        {
          pid: 21,
          command: '"C:\\Users\\tester\\.happier\\bin\\hdev.exe" daemon start-sync',
          type: 'daemon',
        },
      ])
      .mockResolvedValueOnce([
        {
          pid: 21,
          command: '"C:\\Users\\tester\\.happier\\bin\\hdev.exe" daemon start-sync',
          type: 'daemon',
        },
      ]);

    await withPlatform('win32', async () => {
      const { quiesceInstalledCliWindowsPayloadOwners } = await import('./quiesceInstalledCliWindowsPayloadOwners');
      await expect(quiesceInstalledCliWindowsPayloadOwners({
        channel: 'publicdev',
        processEnv: { ...process.env, HAPPIER_HOME_DIR: 'C:\\Users\\tester\\.happier' },
      })).rejects.toThrow(/Failed to stop running Happier runtime processes before payload promotion/i);
    });
  });
});
