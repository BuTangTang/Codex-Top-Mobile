import { resolvePermissionIntentFromMetadataSnapshot } from '@/agent/runtime/permission/permissionModeFromMetadata';
import type { PermissionMode } from '@/api/types';

export function syncClaudePermissionModeFromMetadata(opts: {
  session: {
    client: { getMetadataSnapshot: () => any };
    adoptLastPermissionModeFromMetadata: (mode: PermissionMode, updatedAt: number) => boolean;
  };
  permissionHandler: { handleModeChange: (mode: PermissionMode, updatedAt?: number) => void };
}): PermissionMode | null {
  const updated = adoptClaudePermissionModeFromMetadata({ session: opts.session });
  if (!updated) return null;
  opts.permissionHandler.handleModeChange(updated.intent, updated.updatedAt);
  return updated.intent;
}

export function adoptClaudePermissionModeFromMetadata(opts: {
  session: {
    client: { getMetadataSnapshot: () => any };
    adoptLastPermissionModeFromMetadata: (mode: PermissionMode, updatedAt: number) => boolean;
  };
}): { intent: PermissionMode; updatedAt: number } | null {
  const resolved = resolvePermissionIntentFromMetadataSnapshot({
    metadata: opts.session.client.getMetadataSnapshot(),
  });
  if (!resolved) return null;

  const didChange = opts.session.adoptLastPermissionModeFromMetadata(resolved.intent, resolved.updatedAt);
  if (!didChange) return null;
  return resolved;
}
