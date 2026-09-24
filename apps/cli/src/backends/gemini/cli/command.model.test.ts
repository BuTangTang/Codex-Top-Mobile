import { afterEach, describe, expect, it, vi } from 'vitest';

import { join } from 'node:path';

import { handleGeminiCliCommand } from './command';

const { saveGeminiModelToConfig } = vi.hoisted(() => ({
  saveGeminiModelToConfig: vi.fn(),
}));

vi.mock('@/backends/gemini/utils/config', () => ({
  saveGeminiModelToConfig,
  saveGoogleCloudProjectToConfig: () => {},
  readGeminiLocalConfig: () => ({ token: null, model: null, googleCloudProject: null, googleCloudProjectEmail: null }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  saveGeminiModelToConfig.mockReset();
});

describe('handleGeminiCliCommand (model set)', () => {
  it('accepts freeform model ids', async () => {
    const exitCalls: number[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCalls.push(code ?? 0);
      // Important for testing: throwing for exit(0) would be caught by the
      // command's try/catch and rethrown as an error exit(1).
      if ((code ?? 0) !== 0) {
        throw new Error(`exit:${code ?? 0}`);
      }
      return undefined as never;
    }) as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleGeminiCliCommand({
      args: ['gemini', 'model', 'set', 'custom-model-id'],
      terminalRuntime: null,
    } as any);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(saveGeminiModelToConfig).toHaveBeenCalledWith('custom-model-id');
    expect(exitCalls).toEqual([0]);

    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints the env-aware Gemini config path when GEMINI_CLI_HOME uses ~/', async () => {
    const previousHome = process.env.HOME;
    const previousGeminiCliHome = process.env.GEMINI_CLI_HOME;
    process.env.HOME = '/tmp/scoped-home';
    process.env.GEMINI_CLI_HOME = '~/gemini-cli-home';

    const exitCalls: number[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCalls.push(code ?? 0);
      return undefined as never;
    }) as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await handleGeminiCliCommand({
        args: ['gemini', 'model', 'set', 'custom-model-id'],
        terminalRuntime: null,
      } as any);

      expect(errorSpy).not.toHaveBeenCalled();
      expect(exitCalls).toEqual([0]);
      expect(logSpy).toHaveBeenCalledWith(
        `  Config saved to: ${join('/tmp/scoped-home', 'gemini-cli-home', '.gemini', 'config.json')}`,
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousGeminiCliHome === undefined) delete process.env.GEMINI_CLI_HOME;
      else process.env.GEMINI_CLI_HOME = previousGeminiCliHome;
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('rejects empty model ids', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as any);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handleGeminiCliCommand({
        args: ['gemini', 'model', 'set', '   '],
        terminalRuntime: null,
      } as any),
    ).rejects.toThrow('exit:1');

    expect(saveGeminiModelToConfig).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
