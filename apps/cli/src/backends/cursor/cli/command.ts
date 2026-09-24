import { runCursor } from '@/backends/cursor/runCursor';
import { runBackendSessionCliCommand } from '@/cli/runBackendSessionCliCommand';
import type { CommandContext } from '@/cli/commandRegistry';

export async function handleCursorCliCommand(context: CommandContext): Promise<void> {
  await runBackendSessionCliCommand({
    context,
    loadRun: async () => runCursor,
    agentIdForAccountSettings: 'cursor',
  });
}
