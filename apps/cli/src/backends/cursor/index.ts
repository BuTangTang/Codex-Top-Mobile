import { AGENTS_CORE } from '@happier-dev/agents';

import { checklists } from './cli/checklists';
import type { AgentCatalogEntry } from '../types';
import type { CursorBackendOptions } from './acp/backend';

export const agent = {
  id: AGENTS_CORE.cursor.id,
  cliSubcommand: AGENTS_CORE.cursor.cliSubcommand,
  getCliCommandHandler: async () => (await import('@/backends/cursor/cli/command')).handleCursorCliCommand,
  getCliCapabilityOverride: async () => (await import('@/backends/cursor/cli/capability')).cliCapability,
  getCliDetect: async () => (await import('@/backends/cursor/cli/detect')).cliDetect,
  getCliAuthSpec: async () => (await import('@/backends/cursor/cli/auth/cursorCliAuthSpec')).cursorCliAuthSpec,
  vendorResumeSupport: AGENTS_CORE.cursor.resume.vendorResume,
  getAcpBackendFactory: async () => {
    const { createCursorBackend } = await import('@/backends/cursor/acp/backend');
    return (opts) => ({ backend: createCursorBackend(opts as CursorBackendOptions) });
  },
  getPreflightSessionControlsProbeAdapter: async () =>
    (await import('@/backends/cursor/preflight/cursorPreflightSessionControlsProbeAdapter')).cursorPreflightSessionControlsProbeAdapter,
  needsAccountSettingsForProbes: true,
  checklists,
} satisfies AgentCatalogEntry;
