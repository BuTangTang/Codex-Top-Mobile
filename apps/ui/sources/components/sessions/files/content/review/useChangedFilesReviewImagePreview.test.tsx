import * as React from 'react';
import { Platform } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installFilesContentCommonModuleMocks } from '../filesContentTestHelpers';

const downloadDaemonSessionFileToDestination = vi.hoisted(() => vi.fn());
const createObjectURL = vi.hoisted(() => vi.fn(() => 'blob:changed-file-preview'));
const revokeObjectURL = vi.hoisted(() => vi.fn());
const originalPlatformOS = Platform.OS;

installFilesContentCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSetting: (key: string) => {
                if (key === 'filesImagePreviewCacheMaxEntries') return 10;
                if (key === 'filesImagePreviewCacheMaxTotalBytes') return 1_000_000;
                if (key === 'filesImagePreviewMaxBytes') return 1_000_000;
                return undefined;
            },
        });
    },
});

vi.mock('@/sync/domains/transfers/runtime/bulkTransferPipeline', () => ({
    downloadDaemonSessionFileToDestination,
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
    vi.resetModules();
});

type DownloadMockParams = Readonly<{
    destination: Readonly<{
        writeBytes: (bytes: Uint8Array) => Promise<void>;
        close: () => Promise<void>;
    }>;
    onInit?: ((init: Readonly<{ name: string; sizeBytes: number }>) => Promise<void | Readonly<{ success: false; error: string }>>) | null;
}>;

function installWebPreviewDownloadMock(name: string, bytes = new Uint8Array([1, 2, 3])) {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('Blob', class Blob {
        public readonly chunks: readonly BlobPart[];
        public readonly options: BlobPropertyBag | undefined;
        constructor(chunks: readonly BlobPart[], options?: BlobPropertyBag) {
            this.chunks = chunks;
            this.options = options;
        }
    });
    downloadDaemonSessionFileToDestination.mockImplementation(async (params: DownloadMockParams) => {
        const initResult = await params.onInit?.({ name, sizeBytes: bytes.byteLength });
        if (initResult?.success === false) return { ok: false, error: initResult.error };
        await params.destination.writeBytes(bytes);
        await params.destination.close();
        return { ok: true, name, sizeBytes: bytes.byteLength };
    });
}

describe('useChangedFilesReviewImagePreview', () => {
    it('caches loaded previews by session+signature+path to avoid redundant reads', async () => {
        installWebPreviewDownloadMock('image.png');
        const { useChangedFilesReviewImagePreview } = await import('./useChangedFilesReviewImagePreview');

        let current: any = null;
        function Test(props: { enabled: boolean }) {
            current = useChangedFilesReviewImagePreview({
                sessionId: 's1',
                snapshotSignature: 'sig1',
                filePath: 'image.png',
                enabled: props.enabled,
            });
            return null;
        }

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<Test enabled={true} />)).tree;

        await vi.waitFor(() => {
            expect(current.status).toBe('loaded');
        });
        expect(downloadDaemonSessionFileToDestination).toHaveBeenCalledTimes(1);

        act(() => {
            tree!.update(<Test enabled={true} />);
        });

        expect(downloadDaemonSessionFileToDestination).toHaveBeenCalledTimes(1);
        expect(current.status).toBe('loaded');
        act(() => {
            tree!.unmount();
        });
    });

    it('supports svg preview sources', async () => {
        installWebPreviewDownloadMock('image.svg');
        const { useChangedFilesReviewImagePreview } = await import('./useChangedFilesReviewImagePreview');

        let current: any = null;
        function Test(props: { enabled: boolean }) {
            current = useChangedFilesReviewImagePreview({
                sessionId: 's1',
                snapshotSignature: 'sig1',
                filePath: 'image.svg',
                enabled: props.enabled,
            });
            return null;
        }

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<Test enabled={true} />)).tree;

        await vi.waitFor(() => {
            expect(current.status).toBe('loaded');
        });
        expect(downloadDaemonSessionFileToDestination).toHaveBeenCalledTimes(1);
        expect(typeof current.uri).toBe('string');
        expect(current.uri).toBe('blob:changed-file-preview');

        act(() => {
            tree!.unmount();
        });
    });
});
