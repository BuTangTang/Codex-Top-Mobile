import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshGradientThemeInput } from '@/components/ui/avatar/meshGradient/meshGradientTypes';

class SpyStorage implements Storage {
    readonly getItem = vi.fn((_key: string): string | null => null);
    readonly setItem = vi.fn((_key: string, _value: string): void => {});
    readonly removeItem = vi.fn((_key: string): void => {});
    readonly clear = vi.fn((): void => {});

    get length(): number {
        return 0;
    }

    key(_index: number): string | null {
        return null;
    }
}

vi.mock('react-native-mmkv', () => ({
    MMKV: vi.fn(() => {
        throw new Error('MMKV should not be constructed in web runtime');
    }),
}));

const theme = {
    surfaceBase: '#ffffff',
    surfaceInset: '#f8f8f8',
    surfaceElevated: '#eeeeee',
    secondaryForeground: '#6c6c70',
    accentColors: [
        '#007aff',
        '#34c759',
        '#ff9500',
        '#ffcc00',
        '#ff3b30',
        '#5856d6',
        '#af52de',
    ],
} satisfies MeshGradientThemeInput;

describe('mesh avatar XML cache', () => {
    let storage: SpyStorage;

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', {});
        storage = new SpyStorage();
        vi.stubGlobal('localStorage', storage);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('keeps persistent cache I/O off the synchronous avatar render path', async () => {
        const { getCachedMeshGradientAvatarXml } = await import('./avatarXml');

        const xml = getCachedMeshGradientAvatarXml({
            id: 'session-p14-e1',
            styleId: 'meshGradientRows',
            monochrome: false,
            theme,
        });

        expect(xml).toContain('<svg');
        expect(storage.getItem).not.toHaveBeenCalled();
        expect(storage.setItem).not.toHaveBeenCalled();
    });
});
