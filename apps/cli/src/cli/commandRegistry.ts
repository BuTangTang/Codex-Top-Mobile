import type { TerminalRuntimeFlags } from '@/terminal/runtime/terminalRuntimeFlags';

import { AGENTS, type AgentCatalogEntry } from '@/backends/catalog';

export type CommandContext = Readonly<{
  args: string[];
  rawArgv: string[];
  terminalRuntime: TerminalRuntimeFlags | null;
}>;

export type CommandHandler = (context: CommandContext) => Promise<void>;

// 命中命令后再加载处理器，避免常驻服务初始化未使用的终端界面；字面量路径保留打包器解析能力。
const handleAttachCliCommand: CommandHandler = async (context) => {
  const { handleAttachCliCommand } = await import('./commands/attach');
  await handleAttachCliCommand(context);
};

const handleAutomationCliCommand: CommandHandler = async (context) => {
  const { handleAutomationCliCommand } = await import('./commands/automation');
  await handleAutomationCliCommand(context);
};

const handleAuthCliCommand: CommandHandler = async (context) => {
  const { handleAuthCliCommand } = await import('./commands/auth');
  await handleAuthCliCommand(context);
};

const handleBugReportCliCommand: CommandHandler = async (context) => {
  const { handleBugReportCliCommand } = await import('./commands/bugReport');
  await handleBugReportCliCommand(context);
};

const handleCapabilitiesCliCommand: CommandHandler = async (context) => {
  const { handleCapabilitiesCliCommand } = await import('./commands/capabilities');
  await handleCapabilitiesCliCommand(context);
};

const handleConnectCliCommand: CommandHandler = async (context) => {
  const { handleConnectCliCommand } = await import('./commands/connect');
  await handleConnectCliCommand(context);
};

const handleDaemonCliCommand: CommandHandler = async (context) => {
  const { handleDaemonCliCommand } = await import('./commands/daemon');
  await handleDaemonCliCommand(context);
};

const handleDoctorCliCommand: CommandHandler = async (context) => {
  const { handleDoctorCliCommand } = await import('./commands/doctor');
  await handleDoctorCliCommand(context);
};

const handleInstallCliCommand: CommandHandler = async (context) => {
  const { handleInstallCliCommand } = await import('./commands/install');
  await handleInstallCliCommand(context);
};

const handleLogoutCliCommand: CommandHandler = async (context) => {
  const { handleLogoutCliCommand } = await import('./commands/logout');
  await handleLogoutCliCommand(context);
};

const handleMachineCliCommand: CommandHandler = async (context) => {
  const { handleMachineCliCommand } = await import('./commands/machine');
  await handleMachineCliCommand(context);
};

const handleMcpCliCommand: CommandHandler = async (context) => {
  const { handleMcpCliCommand } = await import('./commands/mcp');
  await handleMcpCliCommand(context);
};

const handleNotifyCliCommand: CommandHandler = async (context) => {
  const { handleNotifyCliCommand } = await import('./commands/notify');
  await handleNotifyCliCommand(context);
};

const handleProfilesCliCommand: CommandHandler = async (context) => {
  const { handleProfilesCliCommand } = await import('./commands/profiles');
  await handleProfilesCliCommand(context);
};

const handlePluginsCompatibilityCliCommand: CommandHandler = async (context) => {
  const { handlePluginsCompatibilityCliCommand } = await import('./commands/pluginsCompatibility');
  await handlePluginsCompatibilityCliCommand(context);
};

const handleRelayCliCommand: CommandHandler = async (context) => {
  const { handleRelayCliCommand } = await import('./commands/relay');
  await handleRelayCliCommand(context);
};

const handleResumeCliCommand: CommandHandler = async (context) => {
  const { handleResumeCliCommand } = await import('./commands/resume');
  await handleResumeCliCommand(context);
};

const handleSessionCliCommand: CommandHandler = async (context) => {
  const { handleSessionCliCommand } = await import('./commands/session/index');
  await handleSessionCliCommand(context);
};

const handleServerCliCommand: CommandHandler = async (context) => {
  const { handleServerCliCommand } = await import('./commands/server');
  await handleServerCliCommand(context);
};

const handleServiceCliCommand: CommandHandler = async (context) => {
  const { handleServiceCliCommand } = await import('./commands/service');
  await handleServiceCliCommand(context);
};

const handleSelfCliCommand: CommandHandler = async (context) => {
  const { handleSelfCliCommand } = await import('./commands/self');
  await handleSelfCliCommand(context);
};

const handleSelfUpdateCliCommand: CommandHandler = async (context) => {
  const { handleSelfUpdateCliCommand } = await import('./commands/selfUpdate');
  await handleSelfUpdateCliCommand(context);
};

const handleSetupCliCommand: CommandHandler = async (context) => {
  const { handleSetupCliCommand } = await import('./commands/setup');
  await handleSetupCliCommand(context);
};

const handleStatusCliCommand: CommandHandler = async (context) => {
  const { handleStatusCliCommand } = await import('./commands/status');
  await handleStatusCliCommand(context);
};

const handleToolsCliCommand: CommandHandler = async (context) => {
  const { handleToolsCliCommand } = await import('./commands/tools');
  await handleToolsCliCommand(context);
};

const handleConfiguredAcpCatalogCliCommand: CommandHandler = async (context) => {
  const { handleConfiguredAcpCatalogCliCommand } = await import('@/agent/acp/catalog/configured/handleConfiguredAcpCatalogCliCommand');
  await handleConfiguredAcpCatalogCliCommand(context);
};

function buildAgentCommandRegistry(): Readonly<Record<string, CommandHandler>> {
  const registry: Record<string, CommandHandler> = {};

  for (const entry of Object.values(AGENTS) as AgentCatalogEntry[]) {
    if (!entry.getCliCommandHandler) continue;
    registry[entry.cliSubcommand] = async (context) => {
      const handler = await entry.getCliCommandHandler!();
      await handler(context);
    };
  }

  return registry;
}

export const commandRegistry: Readonly<Record<string, CommandHandler>> = {
  attach: handleAttachCliCommand,
  automation: handleAutomationCliCommand,
  automations: handleAutomationCliCommand,
  'acp-catalog': handleConfiguredAcpCatalogCliCommand,
  auth: handleAuthCliCommand,
  'bug-report': handleBugReportCliCommand,
  capabilities: handleCapabilitiesCliCommand,
  // Backwards-compatible alias for the MCP command namespace.
  // Prefer `happier mcp ...` in docs and help output.
  bridge: handleMcpCliCommand,
  connect: handleConnectCliCommand,
  daemon: handleDaemonCliCommand,
  doctor: handleDoctorCliCommand,
  install: handleInstallCliCommand,
  logout: handleLogoutCliCommand,
  machine: handleMachineCliCommand,
  mcp: handleMcpCliCommand,
  notify: handleNotifyCliCommand,
  plugins: handlePluginsCompatibilityCliCommand,
  profile: handleProfilesCliCommand,
  profiles: handleProfilesCliCommand,
  relay: handleRelayCliCommand,
  resume: handleResumeCliCommand,
  service: handleServiceCliCommand,
  session: handleSessionCliCommand,
  // Backwards-compatible plural alias; keep the singular command canonical in help.
  sessions: handleSessionCliCommand,
  server: handleServerCliCommand,
  self: handleSelfCliCommand,
  'self-update': handleSelfUpdateCliCommand,
  setup: handleSetupCliCommand,
  status: handleStatusCliCommand,
  tools: handleToolsCliCommand,
  ...buildAgentCommandRegistry(),
};
