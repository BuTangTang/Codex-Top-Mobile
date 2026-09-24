import { describe, expect, it } from 'vitest';

import { normalizePermissionModeForGroup } from '@happier-dev/agents';

describe('normalizePermissionModeForGroup', () => {
  it('keeps provider-agnostic intents for claude sessions', () => {
    expect(normalizePermissionModeForGroup('safe-yolo', 'claude')).toBe('safe-yolo');
    expect(normalizePermissionModeForGroup('yolo', 'claude')).toBe('yolo');
    expect(normalizePermissionModeForGroup('read-only', 'claude')).toBe('read-only');
  });

  it('maps claude modes into codex-like modes', () => {
    expect(normalizePermissionModeForGroup('acceptEdits', 'codexLike')).toBe('safe-yolo');
    expect(normalizePermissionModeForGroup('bypassPermissions', 'codexLike')).toBe('yolo');
    expect(normalizePermissionModeForGroup('plan', 'codexLike')).toBe('plan');
  });

  it('preserves default and codex-like modes while canonicalizing legacy Claude tokens', () => {
    expect(normalizePermissionModeForGroup('default', 'claude')).toBe('default');
    expect(normalizePermissionModeForGroup('acceptEdits', 'claude')).toBe('safe-yolo');
    expect(normalizePermissionModeForGroup('safe-yolo', 'codexLike')).toBe('safe-yolo');
    expect(normalizePermissionModeForGroup('read-only', 'codexLike')).toBe('read-only');
  });

  it('normalizes plan and bypass tokens by group', () => {
    expect(normalizePermissionModeForGroup('plan', 'claude')).toBe('read-only');
    expect(normalizePermissionModeForGroup('plan', 'codexLike')).toBe('plan');
    expect(normalizePermissionModeForGroup('default', 'codexLike')).toBe('default');
    expect(normalizePermissionModeForGroup('bypassPermissions', 'claude')).toBe('yolo');
  });
});
