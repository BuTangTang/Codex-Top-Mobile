import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCredentialsMock = vi.hoisted(() => vi.fn());
const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn());
const bootstrapActiveServerFromWebLocationMock = vi.hoisted(() => vi.fn());
const readWebServerUrlOverrideFromLocationMock = vi.hoisted(() => vi.fn());
const getActiveServerSnapshotMock = vi.hoisted(() => vi.fn(() => ({
    serverId: 'stack',
    serverUrl: 'http://localhost:24731',
})));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentials: (...args: unknown[]) => getCredentialsMock(...args),
        getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlMock(...args),
    },
}));

vi.mock('@/sync/domains/server/url/bootstrapActiveServerFromWebLocation', () => ({
    bootstrapActiveServerFromWebLocation: (...args: unknown[]) => bootstrapActiveServerFromWebLocationMock(...args),
    readWebServerUrlOverrideFromLocation: (...args: unknown[]) => readWebServerUrlOverrideFromLocationMock(...args),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => getActiveServerSnapshotMock(),
}));

describe('resolveBootCredentials', () => {
    beforeEach(() => {
        getCredentialsMock.mockReset();
        getCredentialsForServerUrlMock.mockReset();
        bootstrapActiveServerFromWebLocationMock.mockReset();
        readWebServerUrlOverrideFromLocationMock.mockReset();
        getActiveServerSnapshotMock.mockReset();
        getActiveServerSnapshotMock.mockReturnValue({
            serverId: 'stack',
            serverUrl: 'http://localhost:24731',
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('prefers server-scoped credentials when the web location overrides the server', async () => {
        bootstrapActiveServerFromWebLocationMock.mockReturnValue({
            serverUrl: 'http://localhost:24731',
            cleanedRelativeUrl: '/',
        });
        getCredentialsForServerUrlMock.mockResolvedValue({ token: 'stack-token', secret: 'stack-secret' });

        const { resolveBootCredentials } = await import('./resolveBootCredentials');
        await expect(resolveBootCredentials('web')).resolves.toEqual({ token: 'stack-token', secret: 'stack-secret' });
        expect(bootstrapActiveServerFromWebLocationMock).toHaveBeenCalledWith({ scope: 'device' });
        expect(getCredentialsForServerUrlMock).toHaveBeenCalledWith('http://localhost:24731', { serverId: 'stack' });
        expect(getCredentialsMock).not.toHaveBeenCalled();
    });

    it('does not force the active serverId when the web override points at another server URL', async () => {
        bootstrapActiveServerFromWebLocationMock.mockReturnValue({
            serverUrl: 'http://localhost:24731',
            cleanedRelativeUrl: '/',
        });
        getActiveServerSnapshotMock.mockReturnValue({
            serverId: 'different-server',
            serverUrl: 'http://localhost:24732',
        });
        getCredentialsForServerUrlMock.mockResolvedValue({ token: 'stack-token', secret: 'stack-secret' });

        const { resolveBootCredentials } = await import('./resolveBootCredentials');
        await expect(resolveBootCredentials('web')).resolves.toEqual({ token: 'stack-token', secret: 'stack-secret' });
        expect(bootstrapActiveServerFromWebLocationMock).toHaveBeenCalledWith({ scope: 'device' });
        expect(getCredentialsForServerUrlMock).toHaveBeenCalledWith('http://localhost:24731', undefined);
    });

    it('falls back to default credentials when no web server override exists', async () => {
        bootstrapActiveServerFromWebLocationMock.mockReturnValue(null);
        readWebServerUrlOverrideFromLocationMock.mockReturnValue(null);
        getCredentialsMock.mockResolvedValue({ token: 'default-token', secret: 'default-secret' });

        const { resolveBootCredentials } = await import('./resolveBootCredentials');
        await expect(resolveBootCredentials('web')).resolves.toEqual({ token: 'default-token', secret: 'default-secret' });
        expect(getCredentialsMock).toHaveBeenCalledTimes(1);
    });
});
