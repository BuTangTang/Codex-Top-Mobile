import { agent as codex } from '@/backends/codex';
import type { AgentCatalogEntry, CatalogAgentId } from './types';

/** 产品注册表直接复用正式 Codex 条目，加载函数与缓存仍由共享 catalog 持有。 */
export const AGENTS: Partial<Record<CatalogAgentId, AgentCatalogEntry>> = { codex };

export const CATALOG_AGENT_ID_POLICY: Readonly<{
  defaultAgentId: CatalogAgentId;
  unsupportedAgentId: 'legacy-default' | 'reject';
}> = { defaultAgentId: 'codex', unsupportedAgentId: 'reject' };
