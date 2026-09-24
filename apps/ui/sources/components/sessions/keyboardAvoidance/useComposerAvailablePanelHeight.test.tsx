import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockComposerKeyboardLayout, renderHook, standardCleanup } from '@/dev/testkit';
import {
    ComposerKeyboardProvider,
    useComposerAvailablePanelHeight,
} from '@/components/sessions/keyboardAvoidance';
import type { ComposerKeyboardLayout } from './ComposerKeyboardContext';

describe('useComposerAvailablePanelHeight', () => {
    afterEach(() => {
        vi.useRealTimers();
        standardCleanup();
    });

    it('uses subscription updates instead of reading the shared value during render', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const listeners = new Set<(height: number) => void>();
        let unsubscribeCount = 0;
        const layout = {
            ...createMockComposerKeyboardLayout({ availablePanelHeight: 640 }),
            subscribeAvailablePanelHeight: (listener: (height: number) => void) => {
                listeners.add(listener);
                return () => {
                    unsubscribeCount += 1;
                    listeners.delete(listener);
                };
            },
        } satisfies ComposerKeyboardLayout;

        const wrapper = ({ children }: React.PropsWithChildren) => (
            <ComposerKeyboardProvider layout={layout}>
                {children}
            </ComposerKeyboardProvider>
        );

        const hook = await renderHook(() => useComposerAvailablePanelHeight(), { wrapper });

        // This subscription never publishes synchronously, so the synchronous mount
        // seed reads nothing and the first committed value stays undefined. The value
        // is only ever sourced through the subscription callback, never a shared-value
        // read during render.
        expect(hook.getCurrent()).toBeUndefined();

        act(() => {
            for (const listener of listeners) {
                listener(512);
            }
        });

        expect(hook.getCurrent()).toBe(512);

        await hook.unmount();

        // Two subscribe/unsubscribe cycles: the synchronous mount seed (subscribe +
        // immediate unsubscribe) and the ongoing effect subscription torn down on
        // unmount. The contract under test is that nothing leaks.
        expect(unsubscribeCount).toBe(2);
        expect(listeners.size).toBe(0);
    });

    it('commits the synchronous subscription value on the first render so the panel height does not shift', async () => {
        const layout = createMockComposerKeyboardLayout({ availablePanelHeight: 640 });

        const wrapper = ({ children }: React.PropsWithChildren) => (
            <ComposerKeyboardProvider layout={layout}>
                {children}
            </ComposerKeyboardProvider>
        );

        const committedHeights: Array<number | undefined> = [];
        await renderHook(() => {
            const height = useComposerAvailablePanelHeight();
            committedHeights.push(height);
            return height;
        }, { wrapper });

        // The synchronous subscription publishes the settled value (640) immediately.
        // The first committed render must already carry it so the bottom-anchored
        // composer panel does not size from `undefined` and then re-measure/shift.
        expect(committedHeights[0]).toBe(640);
    });
});
