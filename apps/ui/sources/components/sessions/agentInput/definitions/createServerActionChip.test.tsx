import { describe, expect, it } from 'vitest';

import { createServerActionChip } from './createServerActionChip';

describe('createServerActionChip', () => {
    it('lets the shared popover surface own server selection scrolling', () => {
        const chip = createServerActionChip({
            label: 'Server',
            popoverContent: null,
        });

        expect(chip.collapsedContentPopover?.scrollEnabled).toBe(true);
    });
});
