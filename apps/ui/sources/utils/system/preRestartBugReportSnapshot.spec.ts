import { afterEach, describe, expect, it, vi } from 'vitest';

type FileSystemState = {
    files: Map<string, string>;
    fileText: ReturnType<typeof vi.fn>;
    fileWrite: ReturnType<typeof vi.fn>;
    fileDelete: ReturnType<typeof vi.fn>;
};

const SNAPSHOT_PATH = 'file:///cache/pre-restart-bug-report-snapshot.v1.json';

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

    const module = await import('./preRestartBugReportSnapshot');
    return { module, fileSystem };
}

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unmock('expo-file-system');
    vi.unmock('expo-file-system/legacy');
    vi.unmock('react-native');
});

describe('preRestartBugReportSnapshot native behavior', () => {
    it('persists and reads a native pre-restart snapshot even when top-level expo-file-system legacy methods throw', async () => {
        const { module, fileSystem } = await loadModule({ platformOs: 'android' });
        const createdAtMs = Date.now() - 5_000;

        await module.persistPreRestartBugReportSnapshot({
            v: 1,
            createdAtMs,
            reason: 'crash',
            platform: 'android',
            origin: null,
            isSecureContext: null,
            errorDetails: 'boom',
            appLogs: 'logs',
            userActions: [],
        });

        await expect(module.peekPreRestartBugReportSnapshot()).resolves.toMatchObject({
            v: 1,
            createdAtMs,
            reason: 'crash',
            platform: 'android',
            errorDetails: 'boom',
            appLogs: 'logs',
        });
        expect(fileSystem.fileWrite).toHaveBeenCalledWith(
            SNAPSHOT_PATH,
            expect.stringContaining('"errorDetails":"boom"'),
        );
        expect(fileSystem.fileText).toHaveBeenCalledWith(SNAPSHOT_PATH);
    });

    it('clears an invalid native snapshot payload', async () => {
        const { module, fileSystem } = await loadModule({ platformOs: 'android' });
        fileSystem.files.set(SNAPSHOT_PATH, '{not-json');

        await expect(module.peekPreRestartBugReportSnapshot()).resolves.toBeNull();

        expect(fileSystem.fileDelete).toHaveBeenCalledWith(SNAPSHOT_PATH);
        expect(fileSystem.files.has(SNAPSHOT_PATH)).toBe(false);
    });
});
