import { configuration } from '@/configuration';
import { createTmuxTerminalHostAdapter } from '@/integrations/tmux';
import {
  createZellijTerminalHostAdapter,
  DEFAULT_ZELLIJ_STARTUP_ACTION_TIMEOUT_MS,
} from '@/integrations/zellij/adapter';
import { resolveZellijRuntimeBinary } from '@/integrations/zellij/runtimeBinary';

import { createTerminalHostRegistry, type TerminalHostRegistry } from './registry';

export async function createDefaultTerminalHostRegistry(): Promise<TerminalHostRegistry> {
  const zellijBinary = await resolveZellijRuntimeBinary().catch(() => null);
  return createTerminalHostRegistry([
    createTmuxTerminalHostAdapter(),
    ...(zellijBinary
      ? [
        createZellijTerminalHostAdapter({
          zellijBinary,
          happyHomeDir: configuration.happyHomeDir,
          actionTimeoutMs: configuration.claudeUnifiedTerminalHostActionTimeoutMs,
          startupActionTimeoutMs: Math.max(
            configuration.claudeUnifiedTerminalHostActionTimeoutMs,
            DEFAULT_ZELLIJ_STARTUP_ACTION_TIMEOUT_MS,
          ),
        }),
      ]
      : []),
  ]);
}
