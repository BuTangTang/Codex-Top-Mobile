import { describe, expect, it } from 'vitest';

import type { MachineDisplayRenderable } from './machineDisplayRenderable';
import { getMachineDisplaySubtitle } from './machineDisplayRenderable';

function makeMachineDisplay(partial: Partial<MachineDisplayRenderable> & Pick<MachineDisplayRenderable, 'id'>): MachineDisplayRenderable {
    const updatedAt = partial.updatedAt ?? 0;
    const activeAt = partial.activeAt ?? updatedAt;
    return {
        id: partial.id,
        updatedAt,
        active: partial.active ?? false,
        activeAt,
        revokedAt: partial.revokedAt ?? null,
        metadataVersion: partial.metadataVersion ?? 0,
        metadata: partial.metadata ?? null,
    };
}

describe('getMachineDisplaySubtitle', () => {
    it('uses display fields without resolving a machine by host identity', () => {
        const machine = makeMachineDisplay({
            id: 'machine-a',
            metadata: { displayName: null, host: 'example-host' },
        });

        expect(getMachineDisplaySubtitle(machine, 'machine-a')).toBe('example-host');
    });
});
