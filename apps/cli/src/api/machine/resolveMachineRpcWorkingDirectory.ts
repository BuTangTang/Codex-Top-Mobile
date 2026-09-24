import { homedir as osHomedir } from 'node:os';
import { posix, win32 } from 'node:path';

type Deps = Readonly<{
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  cwd: () => string;
  platform: NodeJS.Platform;
}>;

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

/**
 * Machine/daemon RPC handlers need a stable default directory for relative paths.
 *
 * Filesystem authorization is resolved separately by the filesystem access policy. Do not use
 * `HAPPIER_MACHINE_RPC_WORKING_DIRECTORY` here; that env var is an explicit restriction policy,
 * not the default relative-path base.
 */
export function resolveMachineRpcWorkingDirectory(overrides?: Partial<Deps>): string {
  const env = overrides?.env ?? process.env;
  const cwd = overrides?.cwd ?? process.cwd;
  const fallbackHomedir = overrides?.homedir ?? osHomedir;
  const platform = overrides?.platform ?? process.platform;
  const api = pathApi(platform);

  const envHomeRaw = platform === 'win32'
    ? (env.USERPROFILE || env.HOME)
    : env.HOME;
  const envHomeDir = typeof envHomeRaw === 'string' ? envHomeRaw.trim() : '';
  const candidates = [envHomeDir || fallbackHomedir(), cwd()];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = String(candidate).trim();
    if (!value) continue;
    if (!api.isAbsolute(value)) continue;
    return api.resolve(value);
  }

  return api.resolve(cwd());
}
