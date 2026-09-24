import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerReplaceSpy = vi.fn();
const globalWindow = globalThis as unknown as { window?: Window };
const originalWindow = globalWindow.window;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        Platform: {
            OS: 'web',
            select: (options: Record<string, unknown>) =>
                options.web ?? options.default ?? options.ios ?? options.android,
        },
    });
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        router: {
            replace: routerReplaceSpy,
        },
        params: {},
        pathname: '/',
    }).module;
});

describe('useWebInitialRouteReconcile', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        routerReplaceSpy.mockReset();
        globalWindow.window = {
            location: {
                pathname: '/session/session-1/info',
                search: '?foo=bar',
                hash: '#baz',
            },
        } as unknown as Window;
    });

    afterEach(() => {
        standardCleanup();
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        if (originalWindow === undefined) {
            Reflect.deleteProperty(globalThis, 'window');
        } else {
            globalWindow.window = originalWindow;
        }
    });

    it('reconciles when router hydrates to / but browser location is deeper', async () => {
        const { useWebInitialRouteReconcile } = await import('./useWebInitialRouteReconcile');

        function Probe() {
            useWebInitialRouteReconcile({ routerPathname: '/' });
            return null;
        }

        await renderScreen(<Probe />);

        await act(async () => {
            vi.runAllTimers();
        });

        expect(routerReplaceSpy).toHaveBeenCalledWith('/session/session-1/info?foo=bar#baz');
    });

    it('reconciles to the current browser route when startup strips an initial query param', async () => {
        globalWindow.window = {
            location: {
                pathname: '/restore',
                search: '?happier_hmr=0',
                hash: '',
            },
        } as unknown as Window;

        const { useWebInitialRouteReconcile } = await import('./useWebInitialRouteReconcile');

        function Probe() {
            useWebInitialRouteReconcile({ routerPathname: '/' });
            return null;
        }

        await renderScreen(<Probe />);

        globalWindow.window = {
            location: {
                pathname: '/restore',
                search: '',
                hash: '',
            },
        } as unknown as Window;

        await act(async () => {
            vi.runAllTimers();
        });

        expect(routerReplaceSpy).toHaveBeenCalledWith('/restore');
    });
});
