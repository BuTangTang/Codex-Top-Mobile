export type ZellijWindowsGuardResult =
  | Readonly<{ status: 'ok'; shell?: string; launchStrategy?: 'foreground_windows_terminal' }>
  | Readonly<{
    status: 'disabled';
    reason: 'windows_arm64_unsupported' | 'windows_zellij_unvalidated';
    message: string;
  }>;

export function resolveZellijWindowsGuard(params: Readonly<{
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  env: Readonly<Record<string, string | undefined>>;
  parentProcessName?: string;
}>): ZellijWindowsGuardResult {
  if (params.platform !== 'win32') {
    return { status: 'ok' };
  }

  if (params.arch === 'arm64') {
    return {
      status: 'disabled',
      reason: 'windows_arm64_unsupported',
      message: 'Bundled zellij has no upstream Windows ARM64 binary; install WSL2 or use Agent SDK runner.',
    };
  }

  return {
    status: 'disabled',
    reason: 'windows_zellij_unvalidated',
    message: 'Bundled zellij is not validated on native Windows; use the Windows console host or install WSL2.',
  };
}
