import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-clipboard', () => ({
    getImageAsync: vi.fn(async () => null),
}));

describe('nativeClipboardImageAttachment', () => {
    it('converts a clipboard PNG data URI into an in-memory attachment source', async () => {
        const Clipboard = await import('expo-clipboard');
        (Clipboard.getImageAsync as any).mockResolvedValueOnce({
            data: 'data:image/png;base64,AQID',
            size: { width: 1, height: 1 },
        });

        const { nativeReadClipboardImageAttachment } = await import('./nativeClipboardImageAttachment');
        const picked = await nativeReadClipboardImageAttachment({
            now: new Date('2026-05-10T09:40:00.000Z'),
        });

        expect(Clipboard.getImageAsync).toHaveBeenCalledWith({ format: 'png' });
        expect(picked).toEqual([{
            kind: 'memory',
            name: 'pasted-image-20260510-094000.png',
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
            previewUri: 'data:image/png;base64,AQID',
        }]);
    });

    it('returns no sources when the clipboard does not contain an image', async () => {
        const Clipboard = await import('expo-clipboard');
        (Clipboard.getImageAsync as any).mockResolvedValueOnce(null);

        const { nativeReadClipboardImageAttachment } = await import('./nativeClipboardImageAttachment');

        await expect(nativeReadClipboardImageAttachment()).resolves.toEqual([]);
    });
});
