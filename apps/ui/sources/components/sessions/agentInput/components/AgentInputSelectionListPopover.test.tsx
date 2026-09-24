import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SelectionListProps } from '@/components/ui/selectionList';
import { renderScreen } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capturedSelectionLists: SelectionListProps[] = [];

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            OS: 'ios',
            select: (options: any) => options.ios ?? options.native ?? options.default,
        },
    });
});

vi.mock('@/components/ui/selectionList', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/ui/selectionList')>();
    return {
        ...actual,
        SelectionList: (props: SelectionListProps) => {
            capturedSelectionLists.push(props);
            return React.createElement('SelectionList', { testID: props.testID });
        },
    };
});

vi.mock('../selection/AgentInputSelectionPopover', () => ({
    AgentInputSelectionPopover: (props: {
        children: (args: { maxHeight: number }) => React.ReactNode;
    }) => React.createElement('AgentInputSelectionPopover', null, props.children({ maxHeight: 360 })),
}));

vi.mock('./AgentInputPopoverSurface', () => ({
    AgentInputPopoverSurface: (props: { children?: React.ReactNode }) =>
        React.createElement('AgentInputPopoverSurface', null, props.children),
}));

describe('AgentInputSelectionListPopover', () => {
    it('uses measured native SelectionList height under the computed popover cap by default', async () => {
        const { AgentInputSelectionListPopover } = await import('./AgentInputSelectionListPopover');

        capturedSelectionLists.length = 0;
        await renderScreen(
            <AgentInputSelectionListPopover
                open
                anchorRef={{ current: null }}
                rootStep={{ id: 'root', sections: [] }}
                onSelect={() => {}}
                onRequestClose={() => {}}
            />,
        );

        expect(capturedSelectionLists).toHaveLength(1);
        expect(capturedSelectionLists[0]?.heightBehavior).toBe('measuredToMaxHeight');
    });
});
