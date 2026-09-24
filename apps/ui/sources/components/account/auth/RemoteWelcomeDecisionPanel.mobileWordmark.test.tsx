import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { RemoteWelcomeDecisionPanel } from './RemoteWelcomeDecisionPanel';
import { deriveRemoteAuthEntryOptions, type RemoteAuthEntryOptionsInput } from './useRemoteAuthEntryOptions';

const deviceState = vi.hoisted(() => ({
    width: 390,
    height: 844,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        useWindowDimensions: () => ({
            width: deviceState.width,
            height: deviceState.height,
            scale: 3,
            fontScale: 1,
        }),
    });
});

const noop = () => {};

function createInput(): RemoteAuthEntryOptionsInput {
    return {
        serverAvailability: 'ready',
        serverUrlForCopy: 'https://relay.example.test',
        retryServerCheck: noop,
        signupOptions: {
            anonymousEnabled: true,
            providerIds: Object.freeze([]),
            preferredProviderId: null,
        },
        loginOptions: {
            mtlsEnabled: false,
            keylessProviderIds: Object.freeze([]),
            preferredKeylessProviderId: null,
        },
        providerDisplayNameById: (providerId) => providerId,
        hasPendingTerminalConnect: false,
        hasPendingSetupIntent: false,
    };
}

function renderPanel() {
    return renderScreen(
        <RemoteWelcomeDecisionPanel
            options={deriveRemoteAuthEntryOptions(createInput())}
            isDesktopShell={false}
            layout="portrait"
            onAnonymousSignup={noop}
            onChangeRelay={noop}
            onKeylessProviderLogin={noop}
            onMtlsLogin={noop}
            onOpenSetup={noop}
            onProviderSignup={noop}
            onRestore={noop}
        />,
    );
}

describe('RemoteWelcomeDecisionPanel mobile wordmark', () => {
    beforeEach(() => {
        standardCleanup();
        deviceState.width = 390;
        deviceState.height = 844;
    });

    it('leaves the mobile wordmark to the workflow pane', async () => {
        const screen = await renderPanel();

        expect(screen.findAllByTestId('welcome-mobile-wordmark')).toHaveLength(0);
        expect(screen.findAllByTestId('brand-wordmark')).toHaveLength(0);
    });

    it('does not duplicate the wordmark inside the desktop workflow pane', async () => {
        deviceState.width = 900;
        const screen = await renderPanel();

        expect(screen.findAllByTestId('welcome-mobile-wordmark')).toHaveLength(0);
    });
});
