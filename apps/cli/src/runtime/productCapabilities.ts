import type { ActionId } from '@happier-dev/protocol';

export type CliProductCapabilities = Readonly<{
  id: 'happier' | 'codex-top';
  machineMemory: boolean;
  sessionTools: readonly ('ripgrep' | 'difftastic')[];
  unsupportedActionIds: readonly ActionId[];
}>;

/** 仅保存构建能力事实，不导入 worker、工具或账号状态。 */
export const CLI_PRODUCT_CAPABILITIES: CliProductCapabilities = Object.freeze({
  id: 'happier',
  machineMemory: true,
  sessionTools: Object.freeze(['ripgrep', 'difftastic'] as const),
  unsupportedActionIds: Object.freeze([]),
});
