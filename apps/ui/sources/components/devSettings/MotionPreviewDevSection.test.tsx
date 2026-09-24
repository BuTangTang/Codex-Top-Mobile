import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pressTestInstance, renderScreen, standardCleanup } from '@/dev/testkit';

const modalMock = vi.hoisted(() => {
    const show = vi.fn<(config: unknown) => string>((config) => {
        void config;
        return 'modal-id';
    });
    const hide = vi.fn();
    return {
        spies: { show, hide },
        module: {
            Modal: {
                show,
                hide,
                update: vi.fn(),
                hideAll: vi.fn(),
                alert: vi.fn(),
                alertAsync: vi.fn(),
                prompt: vi.fn(),
                confirm: vi.fn(),
            },
            useOptionalModal: () => ({
                state: { modals: [] },
                showModal: show,
                hideModal: hide,
                hideAllModals: vi.fn(),
                updateCustomModalProps: vi.fn(),
            }),
            ModalProvider: ({ children }: { children?: React.ReactNode }) => children ?? null,
        },
    };
});

vi.mock('@/modal', () => modalMock.module);

// Capture the imperative handle ref + record commitNext / commitPrevious calls
// so we can assert that the carousel preview actually drives the primitive
// (instead of mutating its own activeIndex state directly — RV-4 / F13.4).
const motionMock = vi.hoisted(() => ({
    commitNext: vi.fn(),
    commitPrevious: vi.fn(),
}));

vi.mock('@/components/ui/motion', async () => {
    const ReactModule = await import('react');
    type CarouselProps = Readonly<{
        activeIndex: number;
        itemCount: number;
        onCommitNext: () => void;
        onCommitPrevious: () => void;
        renderItem: (index: number, role: 'previous' | 'current' | 'next') => React.ReactNode;
        testID?: string;
    }>;
    const StoryDeckSlideTransition = ReactModule.forwardRef<
        { commitNext: () => void; commitPrevious: () => void },
        CarouselProps
    >((props, ref) => {
        ReactModule.useImperativeHandle(ref, () => ({
            commitNext: () => {
                motionMock.commitNext();
                props.onCommitNext();
            },
            commitPrevious: () => {
                motionMock.commitPrevious();
                props.onCommitPrevious();
            },
        }), [props]);
        return ReactModule.createElement(
            'CarouselStub',
            { testID: props.testID },
            props.renderItem(props.activeIndex, 'current'),
        );
    });
    return {
        SlideTransitionSwitch: ({ children }: { children?: React.ReactNode }) => children ?? null,
        StoryDeckSlideTransition,
    };
});

function resetMocks() {
    modalMock.spies.show.mockClear();
    modalMock.spies.hide.mockClear();
    motionMock.commitNext.mockClear();
    motionMock.commitPrevious.mockClear();
}

/**
 * R13 — Premium UI gaps round 2 (Fix 6): the motion-primitives dev section
 * MUST be registered on the dev page and MUST open a Modal.show() preview when
 * the row is pressed. Pressing the row drives the preview through the same
 * Modal subsystem as the StoryDeck preview, so we assert the row opens the
 * modal exactly once per press.
 */
describe('MotionPreviewDevSection', () => {
    beforeEach(() => {
        resetMocks();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('renders the slide-variants entry row with a stable testID', async () => {
        const { MotionPreviewDevSection } = await import('./MotionPreviewDevSection');
        const screen = await renderScreen(<MotionPreviewDevSection />);
        expect(screen.findByTestId('dev-motion-preview-slide-variants')).toBeTruthy();
    });

    it('opens the variants preview modal when the entry row is pressed', async () => {
        const { MotionPreviewDevSection } = await import('./MotionPreviewDevSection');
        const screen = await renderScreen(<MotionPreviewDevSection />);

        pressTestInstance(
            screen.findByTestId('dev-motion-preview-slide-variants'),
            'slide variants preview',
        );

        expect(modalMock.spies.show).toHaveBeenCalledTimes(1);
        const config = modalMock.spies.show.mock.calls[0]?.[0] as Readonly<{
            component?: unknown;
            props?: Record<string, unknown>;
        }> | undefined;
        expect(config).toBeTruthy();
        // The preview modal renders a component that accepts an `onClose` prop
        // wired to Modal.hide(); contract is satisfied by the presence of the
        // close handler in props.
        expect(typeof (config?.props as { onClose?: unknown } | undefined)?.onClose).toBe('function');
    });

    /**
     * RV-4 / F13.4 — Carousel variant must drive `StoryDeckSlideTransitionHandle`
     * from its Continue/Back buttons, not mutate `activeIndex` directly. The
     * dev preview is the only place engineers can visually QA the imperative
     * commit path; bypassing it makes the preview misleading.
     */
    it('Carousel preview Continue/Back drives the StoryDeckSlideTransition imperative handle', async () => {
        const { MotionPreviewDevSection: _Section } = await import('./MotionPreviewDevSection');
        // Open the preview modal and render the modal body component directly
        // (the modal subsystem itself is stubbed). The body renders both
        // variants; the carousel preview should exercise the imperative handle.
        const { MotionPreviewDevSection } = await import('./MotionPreviewDevSection');
        const screen = await renderScreen(<MotionPreviewDevSection />);
        pressTestInstance(
            screen.findByTestId('dev-motion-preview-slide-variants'),
            'open preview',
        );

        const config = modalMock.spies.show.mock.calls[0]?.[0] as Readonly<{
            component?: React.ComponentType<{ onClose: () => void }>;
            props?: Record<string, unknown>;
        }> | undefined;
        const ModalBody = config?.component;
        expect(ModalBody).toBeTruthy();
        if (!ModalBody) return;

        const modalScreen = await renderScreen(<ModalBody onClose={() => {}} />);

        const continueButton = modalScreen.findByTestId('dev-motion-preview-carousel-continue');
        expect(continueButton).toBeTruthy();
        const backButton = modalScreen.findByTestId('dev-motion-preview-carousel-back');
        expect(backButton).toBeTruthy();

        act(() => {
            pressTestInstance(continueButton, 'carousel continue');
        });
        expect(motionMock.commitNext).toHaveBeenCalledTimes(1);
        expect(motionMock.commitPrevious).not.toHaveBeenCalled();

        act(() => {
            pressTestInstance(backButton, 'carousel back');
        });
        expect(motionMock.commitPrevious).toHaveBeenCalledTimes(1);
    });
});
