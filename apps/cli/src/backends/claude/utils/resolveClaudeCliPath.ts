import { resolveProviderCliCommand } from '@happier-dev/cli-common/providers';

let cachedResolvedClaudeCliPath: string | null = null;

export function resolveClaudeCliPath(): string {
  if (cachedResolvedClaudeCliPath) {
    return cachedResolvedClaudeCliPath;
  }

  const resolved = resolveProviderCliCommand('claude', {
    processEnv: process.env,
    currentExecPath: process.execPath,
  });
  if (!resolved) {
    throw new ReferenceError(
      'Claude CLI (claude) is not available from any configured source. Install Claude Code or set HAPPIER_CLAUDE_PATH, then restart the daemon.',
    );
  }

  cachedResolvedClaudeCliPath = resolved.command;
  return cachedResolvedClaudeCliPath;
}

export function isClaudeCliJavaScriptFile(cliPath: string): boolean {
  const normalized = typeof cliPath === 'string' ? cliPath.trim() : '';
  return normalized.endsWith('.js') || normalized.endsWith('.cjs') || normalized.endsWith('.mjs');
}
