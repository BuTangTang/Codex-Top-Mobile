import { describe, expect, it, vi } from 'vitest';

describe('AppCrashRecoveryBoundary crash fallback theme', () => {
    it('falls back to the canonical dark theme when persisted theme resolution fails in system dark mode', async () => {
        vi.resetModules();

        vi.doMock('react-native', async () => {
            const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
            return await createReactNativeWebMock({
                Appearance: {
                    getColorScheme: () => 'dark',
                },
            });
        });
        vi.doMock('react-native-unistyles', async () => {
            const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
            return await createUnistylesMock();
        });
        vi.doMock('expo-file-system', () => ({
            File: class MockFile {
                readonly uri: string;

                constructor(...parts: Array<string | { uri: string }>) {
                    this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('');
                }
            },
            Paths: {
                cache: { uri: 'file:///cache/' },
                document: { uri: 'file:///documents/' },
            },
        }));
        vi.doMock('expo-file-system/legacy', () => ({
            EncodingType: { UTF8: 'utf8' },
            cacheDirectory: 'file:///cache/',
        }));
        vi.doMock('@/sync/domains/state/persistence', () => ({
            loadThemeRuntimeLocalState: () => {
                throw new Error('bad persisted settings');
            },
        }));

        const [{ darkTheme }, { resolveCrashRecoveryFallbackTheme }] = await Promise.all([
            import('@/theme'),
            import('./AppCrashRecoveryBoundary'),
        ]);

        expect(resolveCrashRecoveryFallbackTheme()).toBe(darkTheme);
    });
});
