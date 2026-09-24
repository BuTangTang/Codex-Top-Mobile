type ExpoFileHandleLike = {
    offset?: number | null;
    writeBytes: (bytes: Uint8Array) => void;
    close: () => void;
};

type ExpoFileLike = {
    uri: string;
    create: () => void;
    open: () => ExpoFileHandleLike;
    delete: () => void;
};

type ExpoDirectoryLike = {
    uri: string;
    create: (options: { idempotent: boolean; intermediates: boolean }) => void | Promise<void>;
};

type ExpoPathLike = string | ExpoDirectoryLike;

type ExpoFileSystemLike = {
    Paths?: { cache?: ExpoPathLike | null } | null;
    Directory: new (...paths: ExpoPathLike[]) => ExpoDirectoryLike;
    File: new (...paths: ExpoPathLike[]) => ExpoFileLike;
};

export type NativeCacheFileSink = Readonly<{
    fileUri: string;
    close: () => Promise<void>;
    writeBytes: (bytes: Uint8Array) => Promise<void>;
    cleanup: () => Promise<void>;
}>;

export type NativeCacheFileSinkResult =
    | Readonly<{ ok: true; sink: NativeCacheFileSink }>
    | Readonly<{ ok: false; error: string }>;

function sanitizeCacheFileName(name: string): string {
    const trimmed = String(name ?? '').trim();
    const safe = trimmed
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
        .replace(/^\.+/g, '_')
        .slice(0, 160);
    return safe || 'preview';
}

export async function createNativeCacheFileSink(input: Readonly<{
    directoryName: string;
    name: string;
}>): Promise<NativeCacheFileSinkResult> {
    try {
        const imported = await import('expo-file-system');
        // Boundary typing: Expo's JS module shape differs across SDK versions.
        const FileSystem = imported as unknown as ExpoFileSystemLike;
        const cacheRoot = FileSystem.Paths?.cache ?? null;
        const cacheRootUri = typeof cacheRoot === 'string' ? cacheRoot.trim() : String(cacheRoot?.uri ?? '').trim();
        if (!cacheRoot || !cacheRootUri) {
            return { ok: false, error: 'No cache directory available' };
        }

        const cacheSubdir = new FileSystem.Directory(
            typeof cacheRoot === 'string' ? cacheRootUri : cacheRoot,
            sanitizeCacheFileName(input.directoryName),
        );
        await cacheSubdir.create({ idempotent: true, intermediates: true });

        const file = new FileSystem.File(cacheSubdir, sanitizeCacheFileName(input.name));
        file.create();
        const handle = file.open();
        if (typeof handle.offset === 'number' || handle.offset === null) {
            handle.offset = 0;
        }

        const close = async () => {
            try {
                handle.close();
            } catch {
                // Best-effort close.
            }
        };

        const cleanup = async () => {
            try {
                await close();
            } catch {
                // Best-effort cleanup.
            }
            try {
                file.delete();
            } catch {
                // Best-effort cleanup.
            }
        };

        return {
            ok: true,
            sink: {
                fileUri: file.uri,
                close,
                cleanup,
                writeBytes: async (bytes) => {
                    handle.writeBytes(bytes);
                },
            },
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to create cache file sink' };
    }
}
