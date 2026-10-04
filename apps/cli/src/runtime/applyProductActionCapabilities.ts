import type { ActionsSettingsV1 } from '@happier-dev/protocol';
import { CLI_PRODUCT_CAPABILITIES } from '@/runtime/productCapabilities';

/** 只投影本构建不能执行的动作；不修改原账号、环境或持久化设置。 */
export function applyProductActionCapabilities(settings: ActionsSettingsV1): ActionsSettingsV1 {
  const unavailable = CLI_PRODUCT_CAPABILITIES.unsupportedActionIds;
  if (unavailable.every(id => settings.actions[id]?.enabled === false)) return settings;
  const actions = { ...settings.actions };
  for (const id of unavailable) {
    const existing = actions[id] ?? {
      enabledPlacements: [],
      disabledSurfaces: [],
      disabledPlacements: [],
      approvalRequiredSurfaces: [],
      toolExposureModes: {},
    };
    actions[id] = {
      ...existing,
      enabled: false,
    };
  }
  return { ...settings, actions };
}
