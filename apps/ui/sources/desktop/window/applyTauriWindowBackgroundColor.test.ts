import { beforeEach, describe, expect, it, vi } from 'vitest';

const setBackgroundColor = vi.hoisted(() => vi.fn(async () => {}));
const isTauriDesktop = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop,
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        setBackgroundColor,
    }),
}));

describe('applyTauriWindowBackgroundColor', () => {
    beforeEach(() => {
        vi.resetModules();
        isTauriDesktop.mockReset();
        isTauriDesktop.mockReturnValue(true);
        setBackgroundColor.mockClear();
        setBackgroundColor.mockImplementation(async () => {});
    });

    it('applies a valid Tauri window background color', async () => {
        const { applyTauriWindowBackgroundColor } = await import('./applyTauriWindowBackgroundColor');

        await expect(applyTauriWindowBackgroundColor('#181818')).resolves.toBe(true);

        expect(setBackgroundColor).toHaveBeenCalledWith('#181818');
    });

    it('normalizes hex colors before applying them', async () => {
        const { applyTauriWindowBackgroundColor } = await import('./applyTauriWindowBackgroundColor');

        await expect(applyTauriWindowBackgroundColor('F5F5F5')).resolves.toBe(true);

        expect(setBackgroundColor).toHaveBeenCalledWith('#F5F5F5');
    });

    it('does not apply outside the Tauri desktop host', async () => {
        isTauriDesktop.mockReturnValue(false);
        const { applyTauriWindowBackgroundColor } = await import('./applyTauriWindowBackgroundColor');

        await expect(applyTauriWindowBackgroundColor('#181818')).resolves.toBe(false);

        expect(setBackgroundColor).not.toHaveBeenCalled();
    });

    it('skips duplicate background writes', async () => {
        const { applyTauriWindowBackgroundColor } = await import('./applyTauriWindowBackgroundColor');

        await applyTauriWindowBackgroundColor('#181818');
        await applyTauriWindowBackgroundColor('#181818');

        expect(setBackgroundColor).toHaveBeenCalledTimes(1);
    });

    it('rejects unsupported color strings instead of passing them to Tauri', async () => {
        const { applyTauriWindowBackgroundColor } = await import('./applyTauriWindowBackgroundColor');

        await expect(applyTauriWindowBackgroundColor('rgb(24, 24, 24)')).resolves.toBe(false);

        expect(setBackgroundColor).not.toHaveBeenCalled();
    });
});

