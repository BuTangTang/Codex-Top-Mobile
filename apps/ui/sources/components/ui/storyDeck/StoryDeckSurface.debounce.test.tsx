/**
 * RV-4 / F13.3 — Footer-button debounce while a soft-blur transition is in flight.
 *
 * Spam-clicking Continue (or Back) on the soft-blur StoryDeck must not enqueue
 * multiple commitNext()/commitPrevious() calls before the previous spring
 * settles. The first press dispatches; subsequent presses while the transition
 * is in flight are dropped. Once the parent's advance handler runs (the spring
 * has settled), the next press is accepted again.
 */

import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { StoryDeckCard } from '@/changelog/releaseNotes/types';

const shared = vi.hoisted(() => ({
    reducedMotion: false,
    windowWidth: 1200,
    pendingSpringCallbacks: [] as Array<() => void>,
    cancelCount: 0,
    commitNextCount: 0,
    commitPreviousCount: 0,
}));

vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => shared.reducedMotion,
}));

vi.mock('@/components/ui/motion/StepTransitionFrame', () => ({
    StepTransitionFrame: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('StepTransitionFrame', props, children),
    resolveStepTransitionDirection: () => 'replace',
}));

// Replace the real StoryDeckSlideTransition with a stub that exposes the
// imperative handle and counts commit calls. We capture spring callbacks but
// do NOT auto-fire them so the test can simulate "still in flight".
vi.mock('@/components/ui/motion', async () => {
    const ReactModule = await import('react');
    const StoryDeckSlideTransition = ReactModule.forwardRef<
        { commitNext: () => void; commitPrevious: () => void },
        Readonly<{
            activeIndex: number;
            itemCount: number;
            onCommitNext: () => void;
            onCommitPrevious: () => void;
            renderItem: (index: number, role: 'previous' | 'current' | 'next') => React.ReactNode;
            testID?: string;
        }>
    >((props, ref) => {
        // Intentionally NO primitive-level in-flight guard here — this test
        // validates that StoryDeckSurface debounces footer presses at the
        // surface level. Any uncontrolled spam reaching the handle will
        // increment commit counts and FAIL the test.
        ReactModule.useImperativeHandle(ref, () => ({
            commitNext: () => {
                shared.commitNextCount += 1;
                shared.pendingSpringCallbacks.push(() => {
                    props.onCommitNext();
                });
            },
            commitPrevious: () => {
                shared.commitPreviousCount += 1;
                shared.pendingSpringCallbacks.push(() => {
                    props.onCommitPrevious();
                });
            },
        }), [props]);
        return ReactModule.createElement('SoftSlideStub', { testID: props.testID }, props.renderItem(props.activeIndex, 'current'));
    });
    return {
        SlideTransitionSwitch: ({ children }: { children?: React.ReactNode }) => children ?? null,
        StoryDeckSlideTransition,
    };
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        useWindowDimensions: () => ({ width: shared.windowWidth, height: 640 }),
    });
});

vi.mock('expo-image', () => ({
    Image: Object.assign(
        (props: Record<string, unknown>) => React.createElement('Image', props, null),
        { prefetch: vi.fn(async () => true) },
    ),
}));

vi.mock('expo-video', () => ({
    useVideoPlayer: () => ({
        play: vi.fn(),
        pause: vi.fn(),
        addListener: vi.fn(() => ({ remove: vi.fn() })),
    }),
    VideoView: (props: Record<string, unknown>) => React.createElement('VideoView', props, null),
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props, null),
}));

const cards: StoryDeckCard[] = [
    {
        kind: 'list',
        titleKey: 'releaseNotes.test.one',
        rows: [{ iconId: 'sparkles', titleKey: 'releaseNotes.test.row', bodyKey: 'releaseNotes.test.body' }],
    },
    {
        kind: 'list',
        titleKey: 'releaseNotes.test.two',
        rows: [{ iconId: 'rocket', titleKey: 'releaseNotes.test.row', bodyKey: 'releaseNotes.test.body' }],
    },
    {
        kind: 'list',
        titleKey: 'releaseNotes.test.three',
        rows: [{ iconId: 'sparkles', titleKey: 'releaseNotes.test.row', bodyKey: 'releaseNotes.test.body' }],
    },
];

function resetShared(): void {
    shared.pendingSpringCallbacks = [];
    shared.cancelCount = 0;
    shared.commitNextCount = 0;
    shared.commitPreviousCount = 0;
    shared.reducedMotion = false;
    shared.windowWidth = 1200;
}

describe('StoryDeckSurface — footer-button debounce (F13.3)', () => {
    it('drops a second Continue press while a soft-blur commit is in flight, then accepts a new press once the spring settles', async () => {
        resetShared();
        const { StoryDeckSurface } = await import('./StoryDeckSurface');
        const screen = await renderScreen(
            <StoryDeckSurface
                cards={cards}
                onComplete={() => {}}
                slideAnimation="softBlur"
                testID="story"
            />,
        );

        // First press: commitNext should be called once.
        await screen.pressByTestIdAsync('story-footer-primary');
        expect(shared.commitNextCount).toBe(1);
        expect(shared.pendingSpringCallbacks).toHaveLength(1);

        // Spam several more presses BEFORE the spring callback fires. None
        // should reach the imperative handle.
        await screen.pressByTestIdAsync('story-footer-primary');
        await screen.pressByTestIdAsync('story-footer-primary');
        await screen.pressByTestIdAsync('story-footer-primary');
        expect(shared.commitNextCount).toBe(1);

        // Settle the spring (parent advance fires). Wrap in act because the
        // callback triggers `setCurrentIndex` + `setIsSoftSlideTransitioning`
        // on the surface.
        act(() => {
            const cbs = shared.pendingSpringCallbacks.splice(0);
            for (const cb of cbs) cb();
        });

        // After settle, a fresh press is accepted.
        await screen.pressByTestIdAsync('story-footer-primary');
        expect(shared.commitNextCount).toBe(2);
    });
});
