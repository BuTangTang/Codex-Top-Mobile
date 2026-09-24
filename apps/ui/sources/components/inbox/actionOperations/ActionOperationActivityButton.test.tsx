import * as React from 'react';
import { Pressable, View } from 'react-native';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ActionOperationSnapshotV1 } from '@happier-dev/protocol';

import { renderScreen } from '@/dev/testkit';
import { actionOperationStore } from '@/sync/domains/actionOperations/actionOperationStore';

const storageHooks = vi.hoisted(() => ({
    useAllMachines: vi.fn(() => []),
    useAllSessionListRenderables: vi.fn(() => []),
    useAllSessions: vi.fn(() => []),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key === 'inbox.updates' ? 'Activity' : key });
});
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useActiveServerAccountScope: () => ({ accountId: 'account-1', serverId: 'server-1' }),
        useAllMachines: storageHooks.useAllMachines,
        useAllSessions: storageHooks.useAllSessions,
        useAllSessionListRenderables: storageHooks.useAllSessionListRenderables,
    });
});

const capturedPopoverProps: { current: Readonly<Record<string, unknown>> | null } = { current: null };
type CapturedPopoverProps = Readonly<Record<string, unknown>> & Readonly<{
    open: boolean;
    children: React.ReactNode | ((renderProps: Readonly<{ maxHeight: number; maxWidth: number; placement: 'bottom' }>) => React.ReactNode);
}>;
vi.mock('@/components/ui/popover', () => ({
    Popover: React.memo((props: CapturedPopoverProps) => {
        capturedPopoverProps.current = props;
        if (!props.open) return null;
        const content = typeof props.children === 'function'
            ? props.children({ maxHeight: 560, maxWidth: 396, placement: 'bottom' })
            : props.children;
        return <View testID="action-operation-activity-popover">{content}</View>;
    }),
}));
vi.mock('@/components/ui/overlays/FloatingOverlay', () => ({
    FloatingOverlay: React.memo((props: { children: React.ReactNode }) => <View>{props.children}</View>),
}));

function operation(overrides: Partial<ActionOperationSnapshotV1> = {}): ActionOperationSnapshotV1 {
    return {
        version: 1,
        operationId: 'operation-1',
        revision: 1,
        actionId: 'session.fork',
        state: 'running',
        scope: { accountId: 'account-1', machineId: 'machine-1', sessionId: 'session-1' },
        title: 'Fork session',
        createdAt: 100,
        startedAt: 110,
        cancellation: 'unsupported',
        ...overrides,
    };
}

describe('ActionOperationActivityButtonView', () => {
    /** 没有活动时更多入口仍存在，但不挂载账本或绘制独立活动按钮。 */
    it('keeps a custom trigger available without mounting an empty ledger', async () => {
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[]}
                hasAttention={false}
                observationForOperation={() => 'available'}
                contextForOperation={() => null}
                onOpenOperation={() => {}}
                onMarkVisibleTerminalSeen={() => {}}
                renderTrigger={({ hasAttention }: { hasAttention: boolean }) => (
                    <View testID="more-trigger" accessibilityState={{ disabled: !hasAttention }} />
                )}
            />,
        );

        expect(screen.findByTestId('more-trigger')).not.toBeNull();
        expect(screen.findByTestId('more-trigger')?.props.accessibilityState.disabled).toBe(true);
        expect(screen.findByTestId('action-operation-activity-button')).toBeNull();
        expect(screen.findByTestId('action-operation-activity-popover')).toBeNull();
    });

    it('stays absent when there is no active or unseen operation', async () => {
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[]}
                hasAttention={false}
                observationForOperation={() => 'available'}
                contextForOperation={() => null}
                onOpenOperation={() => {}}
                onMarkVisibleTerminalSeen={() => {}}
            />,
        );

        expect(screen.findByTestId('action-operation-activity-button')).toBeNull();
    });

    it('opens the same responsive ledger popover and preserves its anchor contract', async () => {
        const onOpenOperation = vi.fn();
        const markSeen = vi.fn();
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[operation()]}
                hasAttention={true}
                preferredSessionId="session-1"
                observationForOperation={() => 'available'}
                contextForOperation={() => 'Current session'}
                onOpenOperation={onOpenOperation}
                onMarkVisibleTerminalSeen={markSeen}
            />,
        );

        await act(async () => {
            await screen.findByTestId('action-operation-activity-button')?.props.onPress({
                currentTarget: {
                    getBoundingClientRect: () => ({ left: 262, top: 6, width: 44, height: 44 }),
                },
            });
        });

        expect(screen.findByTestId('action-operation-activity-popover')).not.toBeNull();
        expect(screen.findByTestId('action-operation-row-operation-1')).not.toBeNull();
        expect(capturedPopoverProps.current?.placement).toBe('bottom');
        expect(capturedPopoverProps.current?.anchor).toEqual({
            kind: 'rect',
            rect: { left: 262, top: 6, width: 44, height: 44 },
            coordinateSpace: 'window',
        });
        expect(capturedPopoverProps.current?.boundaryRef).toBeNull();
        expect(capturedPopoverProps.current?.portal).toEqual({
            web: { target: 'body' },
            native: true,
            matchAnchorWidth: false,
            anchorAlign: 'end',
        });
        expect(markSeen).toHaveBeenCalled();

        await screen.pressByTestIdAsync('action-operation-row-operation-1');
        expect(onOpenOperation).toHaveBeenCalledWith('operation-1');
    });

    it('keeps an unseen terminal ledger open after marking it seen, then disappears on close', async () => {
        const markSeen = vi.fn();
        const clearRecent = vi.fn();
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const terminal = operation({ state: 'succeeded', settledAt: 200 });
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[terminal]}
                hasAttention={true}
                observationForOperation={() => 'available'}
                contextForOperation={() => null}
                onOpenOperation={() => {}}
                onMarkVisibleTerminalSeen={markSeen}
                onClearRecent={clearRecent}
            />,
        );

        await screen.pressByTestIdAsync('action-operation-activity-button');
        expect(screen.findByTestId('action-operation-activity-popover')).not.toBeNull();
        expect(markSeen).toHaveBeenCalled();

        await screen.pressByTestIdAsync('action-operation-clear-recent');
        expect(clearRecent).toHaveBeenCalledOnce();
        expect(screen.findByTestId('action-operation-activity-popover')).toBeNull();
    });

    it('uses an attention dot instead of an active count for an unavailable projection', async () => {
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[operation()]}
                hasAttention={true}
                observationForOperation={() => 'status_unavailable'}
                contextForOperation={() => null}
                onOpenOperation={() => {}}
                onMarkVisibleTerminalSeen={() => {}}
            />,
        );

        expect(screen.findByTestId('action-operation-activity-count')).toBeNull();
        expect(screen.findByTestId('action-operation-activity-attention-dot')).not.toBeNull();
    });
});

describe('ActionOperationActivityButton', () => {
    /** 自定义更多入口沿用同一懒加载 owner，打开后已读更新不会卸载账本。 */
    it('opens the lazy model-backed ledger from a custom trigger and releases it on close', async () => {
        const terminal = operation({ operationId: 'operation-custom-trigger', state: 'succeeded', settledAt: 200 });
        actionOperationStore.merge(terminal);
        storageHooks.useAllMachines.mockClear();
        storageHooks.useAllSessions.mockClear();
        storageHooks.useAllSessionListRenderables.mockClear();
        const { ActionOperationActivityButton } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButton
                renderTrigger={({ onPress, open }: { onPress: () => void; open: boolean }) => (
                    <Pressable testID="more-activity-trigger" onPress={onPress} accessibilityState={{ expanded: open }} />
                )}
            />,
        );

        expect(screen.findByTestId('action-operation-activity-button')).toBeNull();
        expect(storageHooks.useAllMachines).not.toHaveBeenCalled();
        expect(storageHooks.useAllSessions).not.toHaveBeenCalled();
        expect(storageHooks.useAllSessionListRenderables).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('more-activity-trigger');
        expect(screen.findByTestId(`action-operation-row-${terminal.operationId}`)).not.toBeNull();
        expect(actionOperationStore.getState().terminalSeenAtById.has(terminal.operationId)).toBe(true);
        expect(screen.findByTestId('more-activity-trigger')?.props.accessibilityState.expanded).toBe(true);

        await act(async () => {
            (capturedPopoverProps.current?.onRequestClose as () => void)();
        });
        expect(screen.findByTestId('action-operation-activity-popover')).toBeNull();
        expect(screen.findByTestId('more-activity-trigger')?.props.accessibilityState.expanded).toBe(false);
    });

    it('does not mount detail-only subscriptions until the popover opens', async () => {
        const active = operation({ operationId: 'operation-lazy-details' });
        actionOperationStore.merge(active);
        storageHooks.useAllMachines.mockClear();
        storageHooks.useAllSessions.mockClear();
        storageHooks.useAllSessionListRenderables.mockClear();

        const { ActionOperationActivityButton } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(<ActionOperationActivityButton />);

        expect(storageHooks.useAllMachines).not.toHaveBeenCalled();
        expect(storageHooks.useAllSessions).not.toHaveBeenCalled();
        expect(storageHooks.useAllSessionListRenderables).not.toHaveBeenCalled();

        await screen.pressByTestIdAsync('action-operation-activity-button');

        expect(storageHooks.useAllMachines).toHaveBeenCalledOnce();
        expect(storageHooks.useAllSessions).toHaveBeenCalledOnce();
        expect(storageHooks.useAllSessionListRenderables).toHaveBeenCalledOnce();
        expect(screen.findByTestId(`action-operation-row-${active.operationId}`)).not.toBeNull();
    });

    it('marks terminal operations seen when the model-backed popover opens', async () => {
        const terminal = operation({
            operationId: 'operation-model-backed',
            state: 'succeeded',
            settledAt: 200,
        });
        actionOperationStore.merge(terminal);
        const { ActionOperationActivityButton } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(<ActionOperationActivityButton />);

        expect(actionOperationStore.getState().terminalSeenAtById.has(terminal.operationId)).toBe(false);
        await screen.pressByTestIdAsync('action-operation-activity-button');
        expect(actionOperationStore.getState().terminalSeenAtById.has(terminal.operationId)).toBe(true);
    });
});
