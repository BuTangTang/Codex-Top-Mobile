import { describe, expect, it, vi } from 'vitest';

import { createNativeThemePreferenceTransitionController } from './nativeThemePreferenceTransitionController';

describe('native theme preference transition controller', () => {
    it('captures the current surface before applying the theme mutation and mounts the overlay afterward', async () => {
        const events: string[] = [];
        const controller = createNativeThemePreferenceTransitionController({
            animateOverlay: async () => {
                events.push('animate');
            },
            captureSurface: async () => {
                events.push('capture');
                return 'file://theme-before.png';
            },
            hideOverlay: () => {
                events.push('hide');
            },
            showOverlay: (uri) => {
                events.push(`show:${uri}`);
            },
            waitForFrame: async () => {
                events.push('frame');
            },
            recordBreadcrumb: (breadcrumb) => {
                events.push(`breadcrumb:${breadcrumb.phase}`);
            },
        });

        await controller.run(() => {
            events.push('mutation');
        });

        expect(events).toEqual([
            'capture',
            'breadcrumb:mutation-before-overlay',
            'mutation',
            'breadcrumb:overlay-shown',
            'show:file://theme-before.png',
            'frame',
            'animate',
            'hide',
        ]);
    });

    it('applies the theme mutation immediately when capture fails', async () => {
        const mutation = vi.fn();
        const showOverlay = vi.fn();
        const controller = createNativeThemePreferenceTransitionController({
            animateOverlay: vi.fn(),
            captureSurface: async () => null,
            hideOverlay: vi.fn(),
            showOverlay,
            waitForFrame: vi.fn(),
        });

        await controller.run(mutation);

        expect(mutation).toHaveBeenCalledOnce();
        expect(showOverlay).not.toHaveBeenCalled();
    });

    it('hides the overlay when the reveal animation fails after mounting it', async () => {
        const hideOverlay = vi.fn();
        const controller = createNativeThemePreferenceTransitionController({
            animateOverlay: async () => {
                throw new Error('animation failed');
            },
            captureSurface: async () => 'file://theme-before.png',
            hideOverlay,
            showOverlay: vi.fn(),
            waitForFrame: vi.fn(),
        });

        await expect(controller.run(vi.fn())).rejects.toThrow('animation failed');

        expect(hideOverlay).toHaveBeenCalledOnce();
    });
});
