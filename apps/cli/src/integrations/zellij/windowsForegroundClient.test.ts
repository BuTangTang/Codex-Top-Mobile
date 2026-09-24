import { describe, expect, it, vi } from 'vitest';

const startProcessInWindowsTerminalMock = vi.hoisted(() => vi.fn());

vi.mock('@/terminal/windows/windowsTerminalProcess', () => ({
  startProcessInWindowsTerminal: startProcessInWindowsTerminalMock,
}));

describe('createWindowsTerminalZellijForegroundClientLauncher', () => {
  it('launches a foreground zellij client in Windows Terminal with zellij socket env and shell options', async () => {
    startProcessInWindowsTerminalMock.mockResolvedValueOnce({ ok: true, pid: 1234 });
    const { createWindowsTerminalZellijForegroundClientLauncher } = await import('./windowsForegroundClient');
    const launchClient = createWindowsTerminalZellijForegroundClientLauncher({
      windowId: 'happier-zellij-qa',
      titlePrefix: 'Happier QA',
    });

    await launchClient({
      zellijBinary: 'C:\\Tools\\zellij.exe',
      env: { ZELLIJ_SOCKET_DIR: 'C:\\Temp\\zellij' },
      sessionName: 'happy-claude',
      cwd: 'C:\\repo',
      defaultShell: 'cmd.exe',
      timeoutMs: 5000,
    });

    expect(startProcessInWindowsTerminalMock).toHaveBeenCalledWith({
      filePath: 'C:\\Tools\\zellij.exe',
      args: [
        'attach',
        '--create',
        'happy-claude',
        'options',
        '--default-cwd',
        'C:\\repo',
        '--default-shell',
        'cmd.exe',
      ],
      workingDirectory: 'C:\\repo',
      env: { ZELLIJ_SOCKET_DIR: 'C:\\Temp\\zellij' },
      windowId: 'happier-zellij-qa',
      title: 'Happier QA happy-claude',
      inheritParentEnv: false,
    });
  });

  it('surfaces Windows Terminal launch failures before zellij command injection starts', async () => {
    startProcessInWindowsTerminalMock.mockResolvedValueOnce({ ok: false, errorMessage: 'wt.exe missing' });
    const { createWindowsTerminalZellijForegroundClientLauncher } = await import('./windowsForegroundClient');
    const launchClient = createWindowsTerminalZellijForegroundClientLauncher();

    await expect(launchClient({
      zellijBinary: 'C:\\Tools\\zellij.exe',
      env: { ZELLIJ_SOCKET_DIR: 'C:\\Temp\\zellij' },
      sessionName: 'happy-claude',
      cwd: 'C:\\repo',
      timeoutMs: 5000,
    })).rejects.toThrow(/wt\.exe missing/);
  });
});
