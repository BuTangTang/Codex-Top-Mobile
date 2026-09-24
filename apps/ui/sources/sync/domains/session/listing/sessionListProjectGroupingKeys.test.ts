import { describe, expect, it } from 'vitest';

import { resolveSessionProjectGroupingKeyParts } from './sessionListProjectGroupingKeys';

describe('resolveSessionProjectGroupingKeyParts', () => {
    it('normalizes windows separators and expands ~ using homeDir without grouping by host', () => {
        const parts = resolveSessionProjectGroupingKeyParts({
            host: 'example',
            machineId: 'm1',
            homeDir: 'C:\\Users\\Bob\\',
            path: '~\\repo\\',
        });

        expect(parts.homeDir).toBe('C:/Users/Bob');
        expect(parts.pathKey).toBe('C:/Users/Bob/repo');
        expect(parts.machineGroupId).toBe('id:m1');
    });

    it('preserves UNC/network share prefixes when normalizing slashes', () => {
        const parts = resolveSessionProjectGroupingKeyParts({
            host: 'example',
            machineId: 'm1',
            path: '\\\\server\\share\\repo\\',
        });

        expect(parts.pathKey).toBe('//server/share/repo');
        expect(parts.machineGroupId).toBe('id:m1');
    });

    it('does not use host as a legacy grouping identity when machine id is missing', () => {
        const parts = resolveSessionProjectGroupingKeyParts({
            host: 'example',
            path: '/repo',
        });

        expect(parts.machineGroupId).toBe('unknown');
    });
});
