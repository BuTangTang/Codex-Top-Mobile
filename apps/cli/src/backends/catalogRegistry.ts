import { BUILT_IN_CATALOG_DEFINED_ACP_AGENTS } from '@/agent/acp/catalog';
import { agent as auggie } from '@/backends/auggie';
import { agent as agy } from '@/backends/agy';
import { agent as claude } from '@/backends/claude';
import { agent as codex } from '@/backends/codex';
import { agent as copilot } from '@/backends/copilot';
import { agent as cursor } from '@/backends/cursor';
import { agent as devin } from '@/backends/devin';
import { agent as gemini } from '@/backends/gemini';
import { agent as grok } from '@/backends/grok';
import { agent as kimi } from '@/backends/kimi';
import { agent as kilo } from '@/backends/kilo';
import { agent as opencode } from '@/backends/opencode';
import { agent as pi } from '@/backends/pi';
import { agent as qwen } from '@/backends/qwen';
import { DEFAULT_CATALOG_AGENT_ID } from './types';
import type { AgentCatalogEntry, CatalogAgentId } from './types';

export const AGENTS: Partial<Record<CatalogAgentId, AgentCatalogEntry>> = {
  claude,
  codex,
  gemini,
  opencode,
  auggie,
  qwen,
  kimi,
  kilo,
  grok,
  ...BUILT_IN_CATALOG_DEFINED_ACP_AGENTS,
  pi,
  copilot,
  cursor,
  devin,
  agy,
};

/** 默认 CLI 保留完整注册表与历史缺省规则；产品构建仅替换此数据模块。 */
export const CATALOG_AGENT_ID_POLICY: Readonly<{
  defaultAgentId: CatalogAgentId;
  unsupportedAgentId: 'legacy-default' | 'reject';
}> = { defaultAgentId: DEFAULT_CATALOG_AGENT_ID, unsupportedAgentId: 'legacy-default' };
