import { afterEach, describe, expect, it, vi } from 'vitest';
const fetchArtifactsMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/api/artifacts/apiArtifacts', () => ({
    createArtifact: vi.fn(),
    fetchArtifact: vi.fn(),
    fetchArtifacts: (...args: unknown[]) => fetchArtifactsMock(...args),
    updateArtifact: vi.fn(),
}));

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('fetchAndApplyArtifactsList', () => {
    afterEach(() => {
        fetchArtifactsMock.mockReset();
        vi.resetModules();
    });

    it('drops fetched artifacts when the captured sync scope is stale before apply', async () => {
        const { fetchAndApplyArtifactsList } = await import('./syncArtifacts');
        fetchArtifactsMock.mockResolvedValue([]);

        const applyArtifacts = vi.fn();
        await fetchAndApplyArtifactsList({
            credentials: { token: 'token-a', secret: 'secret-a' },
            encryption: {} as any,
            artifactDataKeys: new Map(),
            applyArtifacts,
            shouldContinue: () => false,
        } as Parameters<typeof fetchAndApplyArtifactsList>[0] & { shouldContinue: () => boolean });

        expect(applyArtifacts).not.toHaveBeenCalled();
    });

    it('does not surface background reachability timeouts through console error', async () => {
        const { fetchAndApplyArtifactsList } = await import('./syncArtifacts');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const error = new Error('Timed out waiting for server reachability');
        error.name = 'ServerFetchConnectivityTimeoutError';
        fetchArtifactsMock.mockRejectedValue(error);

        await expect(fetchAndApplyArtifactsList({
            credentials: { token: 'token-a', secret: 'secret-a' },
            encryption: {} as any,
            artifactDataKeys: new Map(),
            applyArtifacts: vi.fn(),
        })).rejects.toMatchObject({ name: 'ServerFetchConnectivityTimeoutError' });

        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
