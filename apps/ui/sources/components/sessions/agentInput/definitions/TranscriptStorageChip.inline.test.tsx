import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let capturedSelectionListPopoverProps: any = null;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            OS: 'web',
            select: (options: any) => (options && typeof options === 'object' ? options.web ?? options.default : undefined),
        },
        Pressable: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
            React.createElement('Pressable', props, props.children),
        View: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
            React.createElement('View', props, props.children),
    });
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('Text', props, props.children),
}));

vi.mock('@/components/ui/rendering/normalizeNodeForView', () => ({
    normalizeNodeForView: (node: React.ReactNode) => node,
}));

vi.mock('@/components/sessions/agentInput/components/AgentInputSelectionListPopover', () => ({
    AgentInputSelectionListPopover: (props: any) => {
        capturedSelectionListPopoverProps = props;
        return React.createElement('AgentInputSelectionListPopover', props, null);
    },
}));

/**
 * FR4-W1-CHIP: the wrapper `AgentInputSelectionListPopover` is the SINGLE
 * close-after-select owner. The inline `TranscriptStorageChip` (rendered via
 * `chip.render(ctx)`) must NOT close itself in its wrapper-level `onSelect`.
 * Closing happens only via `onRequestClose`, which the wrapper defers on web.
 */
describe('TranscriptStorageChip (inline render path)', () => {
    it('wrapper-level onSelect is a no-op and does NOT close the popover synchronously', async () => {
        capturedSelectionListPopoverProps = null;
        const { createTranscriptStorageActionChip } = await import('./createTranscriptStorageActionChip');
        const chip = createTranscriptStorageActionChip({
            transcriptStorage: 'persisted',
            onStorageChange: () => {},
        });

        const ctx = {
            chipStyle: () => ({ padding: 4 }),
            iconColor: '#000',
            showLabel: true,
            textStyle: {},
            popoverAnchorRef: { current: null },
        } as any;

        const screen = await renderScreen(<>{chip.render(ctx)}</>);

        // Open the popover via the trigger testID.
        await screen.pressByTestIdAsync('agent-input-storage-chip');
        expect(capturedSelectionListPopoverProps?.open).toBe(true);

        const wrapperOnSelect = capturedSelectionListPopoverProps.onSelect as (id: string) => void;
        expect(typeof wrapperOnSelect).toBe('function');

        act(() => {
            wrapperOnSelect('direct');
        });

        // Popover should still be open — the wrapper owns the close path.
        expect(capturedSelectionListPopoverProps?.open).toBe(true);

        act(() => {
            (capturedSelectionListPopoverProps.onRequestClose as () => void)();
        });

        expect(capturedSelectionListPopoverProps?.open).toBe(false);
    });
});
