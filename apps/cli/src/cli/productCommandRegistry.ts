import type { CommandHandler } from '@/cli/commandRegistry';
import { createCliDispatcher } from '@/cli/createCliDispatcher';

/** 字面量加载原命令 owner，完整参数与工作流由原 handler 负责。 */
export const productCommandRegistry: Readonly<Record<string, CommandHandler>> = Object.freeze({
  auth: async (context) => {
    const { handleAuthCliCommand } = await import('@/cli/commands/auth');
    await handleAuthCliCommand(context);
  },
  daemon: async (context) => {
    const { handleDaemonCliCommand } = await import('@/cli/commands/daemon');
    await handleDaemonCliCommand(context);
  },
  codex: async (context) => {
    const { handleCodexCliCommand } = await import('@/backends/codex/cli/command');
    await handleCodexCliCommand(context);
  },
});

/** 产品只发布实际使用的命令；daemon 内部重启与 Codex child 仍走原 namespace。 */
export const dispatchCodexTopCli = createCliDispatcher({
  commandRegistry: productCommandRegistry,
  buildRootHelpText: () => `Codex Top connection

Usage:
  codex-top auth     Manage the mobile connection account
  codex-top daemon   Manage the desktop connection process
  codex-top codex    Run a managed Codex session
  codex-top --version
`,
  isTmuxAllowedCommand: (command) => command === 'codex',
  loadTmuxLauncher: () => import('@/terminal/tmux/startHappyHeadlessInTmux'),
  defaultAgent: null,
});
