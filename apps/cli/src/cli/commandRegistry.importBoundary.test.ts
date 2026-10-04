import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleText } from '@/testkit/logger/captureOutput';
import { setStdioTtyForTest } from '@/testkit/process/stdio';

type SelectorProps = Readonly<{
  onSelect: (method: 'web' | 'mobile') => void;
  onCancel: () => void;
}>;

const uiBoundary = vi.hoisted(() => ({
  loaded: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  uiBoundary.loaded();
  return { ...actual, render: uiBoundary.render };
});

const networkBoundary = vi.hoisted(() => ({
  post: vi.fn(async () => { throw new Error('synthetic relay unavailable'); }),
}));

vi.mock('axios', () => ({ default: { post: networkBoundary.post } }));

describe('command and authentication loading boundaries', () => {
  it('keeps terminal UI unloaded for core imports and noninteractive flows, then preserves selection and cancellation', async () => {
    await withTempDir('happier-cli-import-boundary-', async (home) => {
      const env = createEnvKeyScope([
        'HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL',
        'HAPPIER_AUTH_METHOD', 'HAPPIER_TAILSCALE_AUTO_PUBLIC_URL',
      ]);
      const output = captureConsoleText();
      let restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
      const rawModeDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');
      Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: () => {} });

      try {
        env.patch({
          HAPPIER_HOME_DIR: home,
          HAPPIER_SERVER_URL: 'https://relay.example.test',
          HAPPIER_WEBAPP_URL: 'https://web.example.test',
          HAPPIER_AUTH_METHOD: undefined,
          HAPPIER_TAILSCALE_AUTO_PUBLIC_URL: '0',
        });
        vi.resetModules();

        const { doAuth } = await import('../ui/auth');
        expect(uiBoundary.loaded).not.toHaveBeenCalled();

        const { commandRegistry } = await import('./commandRegistry');
        expect(uiBoundary.loaded).not.toHaveBeenCalled();
        expect(commandRegistry.automations).toBe(commandRegistry.automation);
        expect(commandRegistry.bridge).toBe(commandRegistry.mcp);
        expect(commandRegistry.profile).toBe(commandRegistry.profiles);
        expect(commandRegistry.sessions).toBe(commandRegistry.session);

        const { dispatchCli } = await import('./dispatch');
        for (const flag of ['--help', '--version']) {
          await dispatchCli({ args: [flag], rawArgv: ['happier', flag], terminalRuntime: null });
        }
        expect(output.lines.join('\n')).toContain('happier - AI CLI On the Go');
        await dispatchCli({
          args: ['plugins', 'list', '--json'],
          rawArgv: ['happier', 'plugins', 'list', '--json'],
          terminalRuntime: null,
        });
        expect(output.lines).toContain(JSON.stringify({
          v: 1, ok: true, kind: 'plugins_list', data: { plugins: [] },
        }));
        expect(uiBoundary.loaded).not.toHaveBeenCalled();

        expect(await doAuth()).toBeNull();
        expect(uiBoundary.loaded).not.toHaveBeenCalled();
        expect(networkBoundary.post).toHaveBeenCalledOnce();
        networkBoundary.post.mockClear();
        restoreTty();
        restoreTty = setStdioTtyForTest({ stdin: true, stdout: true });
        uiBoundary.render.mockImplementation((element: ReactElement<SelectorProps>) => {
          setTimeout(() => element.props.onSelect('web'), 0);
          return { unmount: uiBoundary.unmount };
        });
        expect(await doAuth()).toBeNull();
        expect(uiBoundary.loaded).toHaveBeenCalledOnce();
        expect(uiBoundary.render).toHaveBeenCalledWith(expect.anything(), {
          exitOnCtrlC: false, patchConsole: false,
        });
        expect(uiBoundary.unmount).toHaveBeenCalledOnce();
        expect(networkBoundary.post).toHaveBeenCalledOnce();

        networkBoundary.post.mockClear();
        uiBoundary.unmount.mockClear();
        uiBoundary.render.mockImplementation((element: ReactElement<SelectorProps>) => {
          setTimeout(() => element.props.onCancel(), 0);
          return { unmount: uiBoundary.unmount };
        });
        const cancelled = new Error('synthetic process exit');
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw cancelled; });
        await expect(doAuth()).rejects.toBe(cancelled);
        expect(exit).toHaveBeenCalledWith(0);
        expect(uiBoundary.unmount).toHaveBeenCalledOnce();
        expect(networkBoundary.post).not.toHaveBeenCalled();
        expect(output.lines.join('\n')).toContain('Authentication cancelled.');

        await expect(dispatchCli({
          args: ['status', '--yes'], rawArgv: ['happier', 'status', '--yes'], terminalRuntime: null,
        })).rejects.toThrow('happier status is read-only.');
      } finally {
        vi.restoreAllMocks();
        if (rawModeDescriptor) Object.defineProperty(process.stdin, 'setRawMode', rawModeDescriptor);
        else delete (process.stdin as { setRawMode?: unknown }).setRawMode;
        restoreTty();
        output.restore();
        env.restore();
        vi.resetModules();
      }
    });
  });
});
