import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    return {
        ...actual,
        View: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
            React.createElement('View', props, props.children),
    };
});

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: Record<string, unknown>) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/components/sessions/agentInput/components/AgentInputContentPopover', () => ({
    AgentInputContentPopover: (props: Record<string, unknown>) => React.createElement('AgentInputContentPopover', props),
}));

describe('NewSessionWizardAdaptiveSelection', () => {
    it('wraps dropdown triggers in an item group for wizard spacing', async () => {
        const { NewSessionWizardDropdownSelectionItem } = await import('./NewSessionWizardAdaptiveSelection');

        const screen = await renderScreen(
            <NewSessionWizardDropdownSelectionItem
                testID="dropdown-trigger"
                title="Title"
                subtitle="Selected"
                icon={null}
                items={[{ id: 'one', title: 'One' }]}
                selectedId="one"
                boundaryRef={{ current: null } as React.RefObject<any>}
                onSelect={() => {}}
            />,
        );

        const groups = screen.findAllByType('ItemGroup' as any);
        expect(groups).toHaveLength(1);
        expect(groups[0]?.findAllByType('DropdownMenu' as any)).toHaveLength(1);

        const menu = screen.root.findByType('DropdownMenu' as any);
        expect(menu.props.itemTrigger.subtitle).toBe('Selected');
        expect(menu.props.itemTrigger.showSelectedDetail).toBe(false);
        expect(menu.props.itemTrigger.showSelectedSubtitle).toBe(false);
    });

    it('wraps popover triggers in an item group for wizard spacing', async () => {
        const { NewSessionWizardPopoverItem } = await import('./NewSessionWizardAdaptiveSelection');

        const screen = await renderScreen(
            <NewSessionWizardPopoverItem
                testID="popover-trigger"
                title="Title"
                subtitle="Selected"
                icon={null}
                boundaryRef={{ current: null } as React.RefObject<any>}
                popover={{
                    renderContent: () => null,
                    boundaryRef: { current: null } as React.RefObject<any>,
                }}
            />,
        );

        const groups = screen.findAllByType('ItemGroup' as any);
        expect(groups).toHaveLength(1);
        expect(groups[0]?.findAllByType('Item' as any)).toHaveLength(1);
    });
});
