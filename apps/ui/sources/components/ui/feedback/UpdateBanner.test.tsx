import * as React from 'react';
import { Platform } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

vi.mock('./AppUpdateStatusItemBanner', async () => {
    const ReactModule = await import('react');
    return {
        AppUpdateStatusItemBanner: () => ReactModule.createElement('AppUpdateStatusItemBanner', {
            testID: 'mock-app-update-status-item-banner',
        }),
    };
});

const originalPlatformOs = Platform.OS;

describe('UpdateBanner', () => {
    afterEach(() => {
        (Platform as unknown as { OS: typeof originalPlatformOs }).OS = originalPlatformOs;
        standardCleanup();
    });

    it('uses the item-style update banner on web shells', async () => {
        (Platform as unknown as { OS: typeof originalPlatformOs }).OS = 'web';

        const { UpdateBanner } = await import('./UpdateBanner');
        const screen = await renderScreen(<UpdateBanner />);

        expect(screen.findByProps({ testID: 'mock-app-update-status-item-banner' })).toBeTruthy();
    });

    it('uses the item-style update banner on native surfaces', async () => {
        (Platform as unknown as { OS: typeof originalPlatformOs }).OS = 'ios';

        const { UpdateBanner } = await import('./UpdateBanner');
        const screen = await renderScreen(<UpdateBanner />);

        expect(screen.findByProps({ testID: 'mock-app-update-status-item-banner' })).toBeTruthy();
    });
});
