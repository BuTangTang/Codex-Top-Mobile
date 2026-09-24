import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { SidechainHydrationInlineStatus } from './SidechainHydrationInlineStatus';

describe('SidechainHydrationInlineStatus', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('uses terminal unavailable presentation for not_ready status', async () => {
        const screen = await renderScreen(
            <SidechainHydrationInlineStatus
                status="error"
                testID="sidechain-hydration-status"
            />,
        );
        const unavailableText = screen.getTextContent();

        expect(screen.findAllByProps({ accessibilityRole: 'progressbar' })).toHaveLength(0);

        await screen.update(
            <SidechainHydrationInlineStatus
                status="not_ready"
                testID="sidechain-hydration-status"
            />,
        );

        expect(screen.findByTestId('sidechain-hydration-status')).not.toBeNull();
        expect(screen.findAllByProps({ accessibilityRole: 'progressbar' })).toHaveLength(0);
        expect(screen.getTextContent()).toBe(unavailableText);
    });
});
