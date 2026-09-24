import * as React from 'react';
import { View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import type { SelectionListProps, SelectionListStep } from '../_types';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

function makeStep(): SelectionListStep {
    return {
        id: 'root',
        inputPlaceholder: 'Search',
        sections: [
            {
                kind: 'static',
                id: 'favorites',
                title: 'FAVORITES',
                count: 2,
                headerRightAccessory: <View testID="favorites-header-action" />,
                options: [
                    { id: 'fav-a', label: 'Favorite A', testID: 'legacy-favorite-a' },
                    { id: 'fav-b', label: 'Favorite B' },
                ],
            },
            {
                kind: 'static',
                id: 'recent',
                title: 'RECENT',
                options: [
                    { id: 'rec-a', label: 'Recent A' },
                ],
            },
        ],
    };
}

function defaultProps(overrides: Partial<SelectionListProps> = {}): SelectionListProps {
    return {
        rootStep: makeStep(),
        onSelect: vi.fn(),
        onRequestClose: vi.fn(),
        keyboardHintsEnabled: false,
        disableTransitions: true,
        testID: 'sl',
        ...overrides,
    };
}

/**
 * R6 — Premium UI design polish (Fix 1): the section header for non-virtualized
 * sections should use a lighter command-bar primitive (`SelectionListSectionHeader`)
 * rather than the heavy default `ItemGroup` chrome (background card + 32pt
 * padded header bar).
 *
 * Contract: each rendered section in the orchestrator's render plan exposes a
 * stable testID `<sectionTestId>:header` carrying the section title. The
 * primitive renders a flat label (no surface card / no shadow) and the count
 * accessory is preserved.
 */
describe('SelectionList command-bar section header (R6 Fix 1)', () => {
    it('renders each non-virtualized section header under a stable testID', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...defaultProps()} />);
        expect(screen.findByTestId('sl:section:favorites:header')).not.toBeNull();
        expect(screen.findByTestId('sl:section:recent:header')).not.toBeNull();
    });

    it('preserves the section title text and count accessory in the new header', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...defaultProps()} />);
        const text = screen.getTextContent();
        expect(text).toContain('FAVORITES');
        // The `count: 2` accessory is rendered inside the header.
        expect(text).toContain('2');
    });

    it('renders a section header right accessory without replacing title or count', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...defaultProps()} />);
        expect(screen.findByTestId('favorites-header-action')).not.toBeNull();
        expect(screen.getTextContent()).toContain('FAVORITES');
        expect(screen.getTextContent()).toContain('2');
    });

    it('renders an option testID alias on the row item while preserving the canonical option wrapper id', async () => {
        const { SelectionList } = await import('../SelectionList');
        const screen = await renderScreen(<SelectionList {...defaultProps()} />);
        expect(screen.findByTestId('legacy-favorite-a')).not.toBeNull();
        expect(screen.findByTestId('sl:root:option-wrapper:fav-a')).not.toBeNull();
    });
});
