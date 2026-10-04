import { commandRegistry } from '@/cli/commandRegistry';
import { buildRootHelpText } from '@/cli/buildRootHelpText';
import { isTmuxAllowedCommand } from '@/cli/commandSurfaceManifest';
import { requireCatalogEntry } from '@/backends/catalog';
import { DEFAULT_CATALOG_AGENT_ID } from '@/backends/types';
import { createCliDispatcher } from '@/cli/createCliDispatcher';

/** 默认 CLI 仍使用原命令表、帮助和同步缺省后端查找。 */
export const dispatchCli = createCliDispatcher({
  commandRegistry,
  buildRootHelpText,
  isTmuxAllowedCommand,
  loadTmuxLauncher: () => import('@/terminal/tmux/startHappyHeadlessInTmux'),
  defaultAgent: { id: DEFAULT_CATALOG_AGENT_ID, getEntry: () => requireCatalogEntry(DEFAULT_CATALOG_AGENT_ID) },
});
