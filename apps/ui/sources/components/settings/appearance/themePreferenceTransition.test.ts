import { describe, expect, it, vi } from 'vitest';

import {
    runThemePreferenceChange,
    shouldAnimateThemePreferenceChange,
} from './themePreferenceTransition';

describe('theme preference transition', () => {
    it('does not animate when adaptive resolves to the current visual theme', () => {
        expect(shouldAnimateThemePreferenceChange({
            currentPreference: 'dark',
            nextPreference: 'adaptive',
            platform: 'web',
            reduceMotion: false,
            systemTheme: 'dark',
        })).toBe(false);
    });

    it('can force same-mode profile activation animation', () => {
        expect(shouldAnimateThemePreferenceChange({
            currentPreference: 'dark',
            nextPreference: 'dark',
            platform: 'web',
            reduceMotion: false,
            systemTheme: 'dark',
            forceAnimate: true,
        })).toBe(true);
    });

    it('keeps reduced motion authoritative over forced profile activation animation', () => {
        expect(shouldAnimateThemePreferenceChange({
            currentPreference: 'dark',
            nextPreference: 'dark',
            platform: 'web',
            reduceMotion: true,
            systemTheme: 'dark',
            forceAnimate: true,
        })).toBe(false);
    });

    it('uses web view transitions when the visual theme changes on web', async () => {
        const mutation = vi.fn();
        const animate = vi.fn();
        const ready = Promise.resolve();
        const startViewTransition = vi.fn((update: () => void) => {
            update();
            return { ready };
        });
        const webDocument = {
            documentElement: { animate },
            startViewTransition,
        };

        await runThemePreferenceChange({
            currentPreference: 'light',
            nextPreference: 'dark',
            platform: 'web',
            reduceMotion: false,
            systemTheme: 'light',
            webDocument,
            mutation,
        });

        expect(startViewTransition).toHaveBeenCalledOnce();
        expect(mutation).toHaveBeenCalledOnce();
        expect(animate).toHaveBeenCalledWith(
            { clipPath: ['inset(0 0 100% 0)', 'inset(0)'] },
            expect.objectContaining({
                duration: 600,
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
                fill: 'both',
                pseudoElement: '::view-transition-new(root)',
            }),
        );
    });

    it('waits for the web theme mutation to commit before starting the reveal animation', async () => {
        const events: string[] = [];
        let resolveCommit: () => void = () => {
            throw new Error('commit resolver was not initialized');
        };
        const mutation = vi.fn(() => {
            events.push('mutation');
        });
        const animate = vi.fn(() => {
            events.push('animate');
            return {} as Animation;
        });
        const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
            const updateResult = update();
            events.push(updateResult instanceof Promise ? 'update:async' : 'update:sync');
            return {
                ready: Promise.resolve(updateResult).then(() => {
                    events.push('ready');
                }),
            };
        });
        const webDocument = {
            documentElement: { animate },
            startViewTransition,
        };

        const runPromise = runThemePreferenceChange({
            currentPreference: 'light',
            nextPreference: 'dark',
            platform: 'web',
            reduceMotion: false,
            systemTheme: 'light',
            webDocument,
            webMutationCommit: async (commitMutation: () => void) => {
                events.push('commit:start');
                commitMutation();
                await new Promise<void>((resolve) => {
                    resolveCommit = resolve;
                });
                events.push('commit:end');
            },
            mutation,
        });

        await Promise.resolve();

        expect(events).toEqual(['commit:start', 'mutation', 'update:async']);
        expect(animate).not.toHaveBeenCalled();

        resolveCommit();
        await runPromise;

        expect(events).toEqual(['commit:start', 'mutation', 'update:async', 'commit:end', 'ready', 'animate']);
    });

    it('uses the registered native controller when the visual theme changes on native', async () => {
        const mutation = vi.fn();
        const run = vi.fn(async (update: () => void) => {
            update();
        });

        await runThemePreferenceChange({
            currentPreference: 'light',
            nextPreference: 'dark',
            platform: 'ios',
            reduceMotion: false,
            systemTheme: 'light',
            nativeController: { run },
            mutation,
        });

        expect(run).toHaveBeenCalledOnce();
        expect(mutation).toHaveBeenCalledOnce();
    });

    it('does not repeat the native mutation when the transition fails after applying it', async () => {
        const mutation = vi.fn();
        const run = vi.fn(async (update: () => void) => {
            update();
            throw new Error('native transition failed after mutation');
        });

        await runThemePreferenceChange({
            currentPreference: 'light',
            nextPreference: 'dark',
            platform: 'ios',
            reduceMotion: false,
            systemTheme: 'light',
            nativeController: { run },
            mutation,
        });

        expect(run).toHaveBeenCalledOnce();
        expect(mutation).toHaveBeenCalledOnce();
    });

    it('falls back to an immediate mutation when reduced motion is enabled', async () => {
        const mutation = vi.fn();
        const run = vi.fn();

        await runThemePreferenceChange({
            currentPreference: 'light',
            nextPreference: 'dark',
            platform: 'android',
            reduceMotion: true,
            systemTheme: 'light',
            nativeController: { run },
            mutation,
        });

        expect(run).not.toHaveBeenCalled();
        expect(mutation).toHaveBeenCalledOnce();
    });
});
