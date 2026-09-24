import { describe, expect, it } from 'vitest';

import { resolveConnectedServiceProfileIdentityDisplay } from './resolveConnectedServiceIdentityDisplay';

describe('resolveConnectedServiceProfileIdentityDisplay', () => {
    it('keeps the stable profile id visible when provider email is the primary identity', () => {
        const display = resolveConnectedServiceProfileIdentityDisplay({
            profileId: 'work',
            providerEmail: 'work@example.com',
        });

        expect(display.primaryLabel).toBe('work@example.com');
        expect(display.secondaryLabel).toBe('work');
        expect(display.diagnosticLabel).toContain('work@example.com');
        expect(display.diagnosticLabel).toContain('work');
    });

    it('keeps the stable profile id visible when a label masks the provider identity', () => {
        const display = resolveConnectedServiceProfileIdentityDisplay({
            profileId: 'stable-profile-1',
            label: 'batiplus',
            providerEmail: 'person@example.com',
        });

        expect(display.primaryLabel).toBe('batiplus');
        expect(display.secondaryLabel).toContain('person@example.com');
        expect(display.secondaryLabel).toContain('stable-profile-1');
        expect(display.warning).toBe('label_masks_stable_identity');
    });
});
