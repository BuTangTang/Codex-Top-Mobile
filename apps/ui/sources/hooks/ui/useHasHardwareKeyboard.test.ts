import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { renderHook } from '@/dev/testkit/hooks/renderHook';

type MatchMediaStub = (query: string) => {
    matches: boolean;
    addEventListener?: (event: string, cb: (e: any) => void) => void;
    removeEventListener?: (event: string, cb: (e: any) => void) => void;
};

function stubWebPlatform(opts: { fine: boolean; maxTouchPoints?: number }): void {
    const matchMedia: MatchMediaStub = (query) => {
        const matches = query.includes('pointer: fine') ? opts.fine : false;
        return { matches, addEventListener: () => {}, removeEventListener: () => {} };
    };
    vi.stubGlobal('window', { matchMedia });
    vi.stubGlobal('navigator', { maxTouchPoints: opts.maxTouchPoints ?? 0 });
}

describe('useHasHardwareKeyboard', () => {
    beforeEach(() => {
        vi.resetModules();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns true on web when pointer is fine and there are no touch points', async () => {
        vi.doMock('react-native', async () => {
            const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
            return createReactNativeWebMock({ Platform: { OS: 'web' } });
        });
        stubWebPlatform({ fine: true, maxTouchPoints: 0 });
        const { useHasHardwareKeyboard } = await import('./useHasHardwareKeyboard');
        const harness = await renderHook(() => useHasHardwareKeyboard());
        expect(harness.getCurrent()).toBe(true);
    });

    it('returns false on web when the pointer is coarse (touch device)', async () => {
        vi.doMock('react-native', async () => {
            const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
            return createReactNativeWebMock({ Platform: { OS: 'web' } });
        });
        stubWebPlatform({ fine: false, maxTouchPoints: 5 });
        const { useHasHardwareKeyboard } = await import('./useHasHardwareKeyboard');
        const harness = await renderHook(() => useHasHardwareKeyboard());
        expect(harness.getCurrent()).toBe(false);
    });

    it('returns false on web when fine pointer but device also reports touch points (touch laptop)', async () => {
        vi.doMock('react-native', async () => {
            const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
            return createReactNativeWebMock({ Platform: { OS: 'web' } });
        });
        stubWebPlatform({ fine: true, maxTouchPoints: 2 });
        const { useHasHardwareKeyboard } = await import('./useHasHardwareKeyboard');
        const harness = await renderHook(() => useHasHardwareKeyboard());
        expect(harness.getCurrent()).toBe(false);
    });

    it('returns false on native iOS (v1 behavior; native lane belongs to keyboard plan Phase 6)', async () => {
        vi.doMock('react-native', async () => {
            const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
            return createReactNativeWebMock({ Platform: { OS: 'ios' } });
        });
        const { useHasHardwareKeyboard } = await import('./useHasHardwareKeyboard');
        const harness = await renderHook(() => useHasHardwareKeyboard());
        expect(harness.getCurrent()).toBe(false);
    });

    it('returns false on native Android', async () => {
        vi.doMock('react-native', async () => {
            const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
            return createReactNativeWebMock({ Platform: { OS: 'android' } });
        });
        const { useHasHardwareKeyboard } = await import('./useHasHardwareKeyboard');
        const harness = await renderHook(() => useHasHardwareKeyboard());
        expect(harness.getCurrent()).toBe(false);
    });
});
