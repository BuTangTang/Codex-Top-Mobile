import { describe, expect, it, vi } from 'vitest';

import type { EnhancedMode } from './loop';
import { createClaudeUnifiedTerminalMetadataModeApplier } from './unifiedTerminal/metadataRuntimeModeApplier';

describe('createClaudeUnifiedTerminalMetadataModeApplier', () => {
  it('forwards metadata-only permission changes to the live unified runtime-control applier', async () => {
    const apply = vi.fn(async () => ({ promptMayProceed: true, attempted: true } as const));
    const currentMode = {
      permissionMode: 'default',
      claudeUnifiedTerminalEnabled: true,
      claudeUnifiedTerminalHost: 'tmux',
      model: 'sonnet',
    } satisfies EnhancedMode;

    const applyMetadataMode = createClaudeUnifiedTerminalMetadataModeApplier({
      getCurrentMode: () => currentMode,
      getApplier: () => apply,
    });

    await expect(applyMetadataMode('yolo')).resolves.toBe(true);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({
      ...currentMode,
      permissionMode: 'yolo',
    });
  });

  it('reports unapplied metadata changes when the live unified runtime-control applier defers', async () => {
    const apply = vi.fn(async () => ({ promptMayProceed: false, attempted: true } as const));
    const currentMode = {
      permissionMode: 'default',
      claudeUnifiedTerminalEnabled: true,
      claudeUnifiedTerminalHost: 'tmux',
      model: 'sonnet',
    } satisfies EnhancedMode;

    const applyMetadataMode = createClaudeUnifiedTerminalMetadataModeApplier({
      getCurrentMode: () => currentMode,
      getApplier: () => apply,
    });

    await expect(applyMetadataMode('yolo')).resolves.toBe(false);

    expect(apply).toHaveBeenCalledWith({
      ...currentMode,
      permissionMode: 'yolo',
    });
  });

  it('reports unapplied metadata changes when the unified runtime-control applier is not registered yet', async () => {
    const applyMetadataMode = createClaudeUnifiedTerminalMetadataModeApplier({
      getCurrentMode: () => null,
      getApplier: () => null,
    });

    await expect(applyMetadataMode('yolo')).resolves.toBe(false);
  });

  it('replays the latest metadata-only permission change once the runtime-control applier registers', async () => {
    let apply: ((mode: EnhancedMode) => Promise<{ promptMayProceed: boolean; attempted: boolean }>) | null = null;
    const applyMetadataMode = createClaudeUnifiedTerminalMetadataModeApplier({
      getCurrentMode: () => ({
        permissionMode: 'default',
        claudeUnifiedTerminalEnabled: true,
        claudeUnifiedTerminalHost: 'tmux',
        model: 'sonnet',
      } satisfies EnhancedMode),
      getApplier: () => apply,
    });

    await expect(applyMetadataMode('default')).resolves.toBe(false);
    await expect(applyMetadataMode('yolo')).resolves.toBe(false);

    const registeredApply = vi.fn(async () => ({ promptMayProceed: true, attempted: true } as const));
    apply = registeredApply;

    await expect(applyMetadataMode.flushPending()).resolves.toBe(true);

    expect(registeredApply).toHaveBeenCalledTimes(1);
    expect(registeredApply).toHaveBeenCalledWith({
      permissionMode: 'yolo',
      claudeUnifiedTerminalEnabled: true,
      claudeUnifiedTerminalHost: 'tmux',
      model: 'sonnet',
    });
  });
});
