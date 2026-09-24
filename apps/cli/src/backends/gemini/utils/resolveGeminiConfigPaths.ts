import { join } from 'node:path';

import { expandHomeDirPath, resolveHomeDirFromEnvironment } from '@happier-dev/cli-common/providers';

type EnvLike = Readonly<Record<string, string | undefined>>;

function readNonEmptyEnv(env: EnvLike, key: string): string | null {
  const value = env[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveGeminiCliHome(env: EnvLike = process.env): string {
  const explicit = expandHomeDirPath(readNonEmptyEnv(env, 'GEMINI_CLI_HOME') ?? '', env);
  if (explicit.length > 0) {
    return explicit;
  }
  return resolveHomeDirFromEnvironment(env);
}

export function resolveGeminiConfigPaths(env: EnvLike = process.env): Readonly<{
  cliHomeDir: string;
  geminiDir: string;
  xdgConfigHome: string;
  geminiXdgDir: string;
  userSettingsPath: string;
  userConfigPath: string;
  xdgConfigPath: string;
  userAuthPath: string;
  xdgAuthPath: string;
  userOauthCredsPath: string;
}> {
  const cliHomeDir = resolveGeminiCliHome(env);
  const xdgConfigHome = expandHomeDirPath(readNonEmptyEnv(env, 'XDG_CONFIG_HOME') ?? '', env) || join(cliHomeDir, '.config');
  const geminiDir = join(cliHomeDir, '.gemini');
  const geminiXdgDir = join(xdgConfigHome, 'gemini');
  return {
    cliHomeDir,
    geminiDir,
    xdgConfigHome,
    geminiXdgDir,
    userSettingsPath: join(geminiDir, 'settings.json'),
    userConfigPath: join(geminiDir, 'config.json'),
    xdgConfigPath: join(geminiXdgDir, 'config.json'),
    userAuthPath: join(geminiDir, 'auth.json'),
    xdgAuthPath: join(geminiXdgDir, 'auth.json'),
    userOauthCredsPath: join(geminiDir, 'oauth_creds.json'),
  };
}
