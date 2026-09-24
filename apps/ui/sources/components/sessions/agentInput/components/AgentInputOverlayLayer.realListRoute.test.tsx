import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installAgentInputCommonModuleMocks } from '../agentInputTestHelpers';
import type { AgentInputExtraActionChip } from '../agentInputContracts';
import { buildOverlayLayerFixture } from './__tests__/buildOverlayLayerFixture';
import type { SelectionListStep } from '@/components/ui/selectionList';

installAgentInputCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'web' },
        });
    },
});

vi.mock('@/components/ui/popover', () => ({
    MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS: undefined,
    Popover: (
        props: Readonly<{
            open?: boolean;
            children?: React.ReactNode | ((args: { maxHeight: number }) => React.ReactNode);
        }>,
    ) => {
        const child = typeof props.children === 'function'
            ? props.children({ maxHeight: 312 })
            : props.children ?? null;
        return React.createElement('Popover', props, props.open ? child : null);
    },
    PopoverScope: ({ children }: Readonly<{ children?: React.ReactNode }>) => (
        React.createElement(React.Fragment, null, children)
    ),
}));

vi.mock('./AgentInputChipPickerPopover', () => ({
    AgentInputChipPickerPopover: () => null,
}));

vi.mock('./AgentInputChipPickerLayout', () => ({
    shouldShowAgentInputChipPickerRail: () => true,
}));

vi.mock('./AgentInputContentPopover', () => ({
    AgentInputContentPopover: () => null,
}));

vi.mock('./AgentInputActionMenuPopoverContent', () => ({
    AgentInputActionMenuPopoverContent: () => null,
}));

vi.mock('./PermissionModePicker', () => ({
    PermissionModePicker: () => null,
}));

vi.mock('@/sync/domains/permissions/permissionModeOptions', () => ({
    getPermissionModeTitleForAgentType: () => 'Permissions',
}));

function buildListChip(rootStep: SelectionListStep): AgentInputExtraActionChip {
    return {
        key: 'real-list-route',
        controlId: 'recipient',
        collapsedOptionsPopover: {
            presentation: 'list',
            title: 'Real list route',
            label: 'Route',
            rootStep,
            selectedOptionId: 'one',
            onSelect: () => {
                throw new Error('list route must not call descriptor-level onSelect');
            },
        },
        render: () => null,
    };
}

describe("AgentInputOverlayLayer presentation:'list' composed row selection", () => {
    it('dispatches the row callback through the real SelectionList route and closes once via the wrapper', async () => {
        vi.useFakeTimers();
        try {
            const selectedIds: string[] = [];
            const onClose = vi.fn();
            const rootStep: SelectionListStep = {
                id: 'root',
                title: 'Root',
                sections: [
                    {
                        kind: 'static',
                        id: 'main',
                        options: [
                            {
                                id: 'one',
                                label: 'One',
                                onSelect: () => selectedIds.push('one'),
                            },
                            {
                                id: 'two',
                                label: 'Two',
                                onSelect: () => selectedIds.push('two'),
                            },
                        ],
                    },
                ],
            };
            const { AgentInputOverlayLayer } = await import('./AgentInputOverlayLayer');

            const screen = await renderScreen(
                <AgentInputOverlayLayer
                    {...buildOverlayLayerFixture({
                        activeExtraCollapsedPopoverChip: buildListChip(rootStep),
                        onActiveExtraCollapsedPopoverChipClose: onClose,
                    })}
                />,
            );

            await screen.pressByTestIdAsync('selection-list:root:option:two');

            expect(selectedIds).toEqual(['two']);
            expect(onClose).not.toHaveBeenCalled();

            vi.runAllTimers();
            expect(onClose).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
