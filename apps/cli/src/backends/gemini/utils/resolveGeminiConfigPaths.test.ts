import { describe, expect, it } from 'vitest';

import { join } from 'node:path';

import { resolveGeminiCliHome, resolveGeminiConfigPaths } from './resolveGeminiConfigPaths';

describe('resolveGeminiConfigPaths', () => {
  it('expands ~/ overrides for GEMINI_CLI_HOME and XDG_CONFIG_HOME against HOME', () => {
    const env = {
      HOME: '/tmp/scoped-home',
      GEMINI_CLI_HOME: '~/gemini-cli-home',
      XDG_CONFIG_HOME: '~/xdg-config-home',
    };

    expect(resolveGeminiCliHome(env)).toBe('/tmp/scoped-home/gemini-cli-home');
    expect(resolveGeminiConfigPaths(env)).toMatchObject({
      cliHomeDir: '/tmp/scoped-home/gemini-cli-home',
      geminiDir: '/tmp/scoped-home/gemini-cli-home/.gemini',
      xdgConfigHome: '/tmp/scoped-home/xdg-config-home',
      geminiXdgDir: '/tmp/scoped-home/xdg-config-home/gemini',
    });
  });

  it('falls back to HOME when GEMINI_CLI_HOME is unset', () => {
    const env = {
      HOME: '/tmp/linux-home',
    };

    expect(resolveGeminiCliHome(env)).toBe('/tmp/linux-home');
    expect(resolveGeminiConfigPaths(env).userConfigPath).toBe(
      join('/tmp/linux-home', '.gemini', 'config.json'),
    );
  });
});
