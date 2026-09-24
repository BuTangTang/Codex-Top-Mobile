import { afterEach, describe, expect, it, vi } from 'vitest';

type FileSystemState = {
    files: Map<string, string>;
    fileText: ReturnType<typeof vi.fn>;
    fileWrite: ReturnType<typeof vi.fn>;
    fileDelete: ReturnType<typeof vi.fn>;
};

function createFileSystemState(): FileSystemState {
    const files = new Map<string, string>();
    return {
        files,
        fileText: vi.fn(),
        fileWrite: vi.fn(),
        fileDelete: vi.fn(),
    };
}

async function loadModule(options?: { platformOs?: 'ios' | 'android' | 'web' }) {
    vi.resetModules();

    const fileSystem = createFileSystemState();
    vi.doMock('expo-file-system', () => ({
        File: class MockFile {
            uri: string;

            constructor(...parts: Array<string | { uri: string }>) {
                this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('');
            }

            get exists() {
                return fileSystem.files.has(this.uri);
            }

            async text() {
                fileSystem.fileText(this.uri);
                const value = fileSystem.files.get(this.uri);
                if (typeof value !== 'string') throw new Error(`missing file: ${this.uri}`);
                return value;
            }

            write(payload: string) {
                fileSystem.fileWrite(this.uri, payload);
                fileSystem.files.set(this.uri, payload);
            }

            delete() {
                fileSystem.fileDelete(this.uri);
                fileSystem.files.delete(this.uri);
            }
        },
        Paths: {
            cache: { uri: 'file:///cache/' },
            document: { uri: 'file:///documents/' },
        },
    }));
    vi.doMock('expo-file-system/legacy', () => ({
        cacheDirectory: 'file:///cache/',
        documentDirectory: 'file:///documents/',
        EncodingType: { UTF8: 'utf8' },
        getInfoAsync: vi.fn(async () => {
            throw new Error('legacy file-system getInfoAsync should not be used');
        }),
        readAsStringAsync: vi.fn(async () => {
            throw new Error('legacy file-system readAsStringAsync should not be used');
        }),
        writeAsStringAsync: vi.fn(async () => {
            throw new Error('legacy file-system writeAsStringAsync should not be used');
        }),
        deleteAsync: vi.fn(async () => {
            throw new Error('legacy file-system deleteAsync should not be used');
        }),
    }));
    vi.doMock('react-native', () => ({
        Platform: { OS: options?.platformOs ?? 'ios' },
    }));

    const module = await import('./restartBugReportIntent');
    return { module, fileSystem };
}

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unmock('expo-file-system');
    vi.unmock('expo-file-system/legacy');
    vi.unmock('react-native');
});

describe('restartBugReportIntent native behavior', () => {
    it('persists and consumes a native restart intent even when top-level expo-file-system legacy methods throw', async () => {
        const { module, fileSystem } = await loadModule({ platformOs: 'android' });
        const createdAtMs = Date.now() - 5_000;

        await module.persistRestartBugReportIntent({
            v: 1,
            createdAtMs,
            reason: 'crash',
        });

        await expect(module.consumeRestartBugReportIntent()).resolves.toBe(true);
        await expect(module.consumeRestartBugReportIntent()).resolves.toBe(false);

        expect(fileSystem.fileWrite).toHaveBeenCalledWith(
            'file:///cache/restart-bug-report-intent.v1.json',
            expect.stringContaining('"reason":"crash"'),
        );
        expect(fileSystem.fileText).toHaveBeenCalledWith('file:///cache/restart-bug-report-intent.v1.json');
        expect(fileSystem.fileDelete).toHaveBeenCalledWith('file:///cache/restart-bug-report-intent.v1.json');
        expect(fileSystem.files.size).toBe(0);
    });
});
