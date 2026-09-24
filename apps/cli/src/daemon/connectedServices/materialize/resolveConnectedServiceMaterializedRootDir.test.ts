import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveConnectedServiceMaterializedRootDir } from './resolveConnectedServiceMaterializedRootDir';

describe('resolveConnectedServiceMaterializedRootDir', () => {
  it('derives the deterministic root from a valid materialization identity id (the segment the spawn path uses)', () => {
    expect(resolveConnectedServiceMaterializedRootDir({
      baseDir: '/home/user/.happier/daemon/connected-services/materialized',
      agentId: 'pi',
      materializationKey: 'session-123',
      materializationIdentity: { v: 1, id: 'csm_abc', createdAtMs: 123 },
    })).toBe(join('/home/user/.happier/daemon/connected-services/materialized', 'csm_abc', 'pi'));
  });

  it('falls back to the sha256-normalized materialization key when no valid identity is present', () => {
    // No (valid) identity → segment is the sha256 of the key, exactly as
    // materializeConnectedServicesForSpawn computes it. This keeps the inactive-switch reconstruction
    // byte-identical to what the next spawn will materialize into.
    const key = 'spawn-1700000000000-abcd';
    const expectedSegment = createHash('sha256').update(key, 'utf8').digest('hex');
    expect(resolveConnectedServiceMaterializedRootDir({
      baseDir: '/base',
      agentId: 'codex',
      materializationKey: key,
      materializationIdentity: null,
    })).toBe(join('/base', expectedSegment, 'codex'));
  });

  it('falls back to the normalized key when the identity is present but invalid (missing createdAtMs)', () => {
    const key = 'session-xyz';
    const expectedSegment = createHash('sha256').update(key, 'utf8').digest('hex');
    expect(resolveConnectedServiceMaterializedRootDir({
      baseDir: '/base',
      agentId: 'pi',
      materializationKey: key,
      // Invalid identity (schema requires createdAtMs) → rejected → key fallback.
      materializationIdentity: { v: 1, id: 'csm_incomplete' } as never,
    })).toBe(join('/base', expectedSegment, 'pi'));
  });
});
