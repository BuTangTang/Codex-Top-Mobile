import type { PermissionMode } from '@/api/types';

import type { EnhancedMode } from '../loop';
import type { ClaudeUnifiedRuntimeControlApplyResult } from './runtimeControlIntegration';

export type ClaudeUnifiedTerminalMetadataModeApplier = ((
  permissionMode: PermissionMode,
) => Promise<boolean>) & {
  flushPending: () => Promise<boolean>;
};

export function createClaudeUnifiedTerminalMetadataModeApplier(opts: Readonly<{
  getCurrentMode: () => EnhancedMode | null;
  getApplier: () => ((mode: EnhancedMode) => Promise<ClaudeUnifiedRuntimeControlApplyResult>) | null;
}>): ClaudeUnifiedTerminalMetadataModeApplier {
  let pendingPermissionMode: PermissionMode | null = null;

  const flushPending = async (): Promise<boolean> => {
    const permissionMode = pendingPermissionMode;
    if (!permissionMode) return true;
    const apply = opts.getApplier();
    if (!apply) return false;
    const result = await apply({
      ...(opts.getCurrentMode() ?? {
        permissionMode,
        claudeUnifiedTerminalEnabled: true,
      }),
      permissionMode,
    });
    pendingPermissionMode = null;
    return result.promptMayProceed;
  };

  const applyMetadataMode = (async (permissionMode) => {
    pendingPermissionMode = permissionMode;
    return flushPending();
  }) as ClaudeUnifiedTerminalMetadataModeApplier;

  applyMetadataMode.flushPending = flushPending;

  return applyMetadataMode;
}
