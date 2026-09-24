import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { flushHookEffects, renderHook } from '@/dev/testkit';

const stableCredentials = {
    token: 't',
    secret: Buffer.from(new Uint8Array(32).fill(3)).toString('base64url'),
} as const;

let currentCredentials: Readonly<{ token: string; secret: string }> | null = stableCredentials;

const { fetchAccountEncryptionModeSpy } = vi.hoisted(() => ({
    fetchAccountEncryptionModeSpy: vi.fn<
        (...args: Parameters<typeof fetchAccountEncryptionMode>) => ReturnType<typeof fetchAccountEncryptionMode>
    >(async () => ({ mode: 'e2ee', updatedAt: 0 })),
}));

vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: fetchAccountEncryptionModeSpy,
}));

describe('useCredentialScopedAccountModeResolver', () => {
    beforeEach(() => {
        currentCredentials = stableCredentials;
        vi.clearAllMocks();
        fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'e2ee', updatedAt: 0 });
    });

    it('does not cache the fallback mode after a transient account-mode fetch failure', async () => {
        fetchAccountEncryptionModeSpy
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce({ mode: 'plain', updatedAt: 1 });

        const { useCredentialScopedAccountModeResolver } = await import('./useCredentialScopedAccountModeResolver');
        const hook = await renderHook(() => useCredentialScopedAccountModeResolver({
            credentials: currentCredentials,
            credentialScope: 'credential-scope-1',
        }));

        await flushHookEffects({ cycles: 3, turns: 3 });

        const firstResult = await hook.getCurrent()();
        const secondResult = await hook.getCurrent()();

        expect(firstResult).toBe('e2ee');
        expect(secondResult).toBe('plain');
        expect(fetchAccountEncryptionModeSpy).toHaveBeenCalledTimes(2);

        await hook.unmount();
    });
});
