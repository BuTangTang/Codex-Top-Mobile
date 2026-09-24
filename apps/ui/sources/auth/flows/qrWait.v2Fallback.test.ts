import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import sodium from '@/encryption/libsodium.lib';
import { encodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import { generateAuthKeyPair } from './qrStart';
import { authQRWait } from './qrWait';
import { serverFetch } from '@/sync/http/client';

const activeServerSnapshot = vi.hoisted(() => ({
    serverId: 'relay-example',
    serverUrl: 'https://relay.example.test',
    generation: 0,
}));

const setServerProfileIdentityForUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({
    serverFetch: vi.fn(),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => activeServerSnapshot,
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    setServerProfileIdentityForUrl: (...args: unknown[]) => setServerProfileIdentityForUrlMock(...args),
}));

type StubResponse = {
    ok: boolean;
    status: number;
    json: () => Promise<any>;
};

function makeJsonResponse(status: number, payload: any): StubResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    };
}

describe('authQRWait v2 fallback', () => {
    beforeEach(() => {
        Object.assign(activeServerSnapshot, { serverId: 'relay-example', serverUrl: 'https://relay.example.test', generation: 0 });
        setServerProfileIdentityForUrlMock.mockClear();
        vi.mocked(serverFetch).mockReset();
    });

    beforeAll(async () => {
        await sodium.ready;
    });

    it('uses /v2/auth/account/request when available', async () => {
        const keypair = generateAuthKeyPair();
        const expectedToken = 'tkn-test-1';
        const expectedSecret = new Uint8Array([1, 2, 3, 4]);

        const tokenEncrypted = encodeBase64(encryptBox(new TextEncoder().encode(expectedToken), keypair.publicKey));
        const responseEncrypted = encodeBase64(encryptBox(expectedSecret, keypair.publicKey));

        const fetchMock = vi.mocked(serverFetch);
        fetchMock.mockReset();
        fetchMock.mockResolvedValueOnce(
            makeJsonResponse(200, { state: 'authorized', tokenEncrypted, response: responseEncrypted }) as any,
        );

        const out = await authQRWait(keypair);
        expect(out?.token).toBe(expectedToken);
        expect(out?.secret).toEqual(expectedSecret);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('/v2/auth/account/request');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to /v1/auth/account/request when /v2 is missing', async () => {
        const keypair = generateAuthKeyPair();
        const expectedToken = 'tkn-test-2';
        const expectedSecret = new Uint8Array([9, 8, 7]);

        const responseEncrypted = encodeBase64(encryptBox(expectedSecret, keypair.publicKey));

        const fetchMock = vi.mocked(serverFetch);
        fetchMock.mockReset();
        fetchMock.mockResolvedValueOnce(makeJsonResponse(404, { error: 'Not Found' }) as any);
        fetchMock.mockResolvedValueOnce(
            makeJsonResponse(200, { state: 'authorized', token: expectedToken, response: responseEncrypted }) as any,
        );

        const out = await authQRWait(keypair);
        expect(out?.token).toBe(expectedToken);
        expect(out?.secret).toEqual(expectedSecret);
        expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
            '/v2/auth/account/request',
            '/v1/auth/account/request',
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('stores server identity from authorized auth responses', async () => {
        const keypair = generateAuthKeyPair();
        const expectedToken = 'tkn-test-identity';
        const expectedSecret = new Uint8Array([4, 5, 6]);
        const responseEncrypted = encodeBase64(encryptBox(expectedSecret, keypair.publicKey));

        setServerProfileIdentityForUrlMock.mockClear();
        const fetchMock = vi.mocked(serverFetch);
        fetchMock.mockReset();
        fetchMock.mockResolvedValueOnce(
            makeJsonResponse(200, {
                state: 'authorized',
                token: expectedToken,
                response: responseEncrypted,
                serverIdentityId: 'srv_auth_identity',
            }) as any,
        );

        const out = await authQRWait(keypair);

        expect(out?.token).toBe(expectedToken);
        expect(setServerProfileIdentityForUrlMock).toHaveBeenCalledWith(
            'https://relay.example.test',
            'srv_auth_identity',
        );
    });
    it.each(['switch', 'generation', 'cancel'])('rejects a late response body after %s without publishing identity or credentials', async (change) => {
        const keypair = generateAuthKeyPair();
        const encrypted = encodeBase64(encryptBox(new Uint8Array([1, 2, 3]), keypair.publicKey));
        let complete!: (value: unknown) => void;
        let parsing!: () => void;
        const parsingStarted = new Promise<void>((resolve) => { parsing = resolve; });
        let cancelled = false;
        vi.mocked(serverFetch).mockResolvedValueOnce({ ok: true, status: 200, json: () => {
            parsing();
            return new Promise((resolve) => { complete = resolve; });
        } } as Response);
        const pending = authQRWait(keypair, undefined, () => cancelled);
        await parsingStarted;
        // 只延迟响应体；绕过不了 serverFetch 已有的响应头返回时检查。
        if (change === 'switch') Object.assign(activeServerSnapshot, { serverId: 'server-c', serverUrl: 'https://c.example.test', generation: 1 });
        if (change === 'generation') activeServerSnapshot.generation += 1;
        if (change === 'cancel') cancelled = true;
        complete({ state: 'authorized', token: 'synthetic-b-token', response: encrypted, serverIdentityId: 'synthetic-b-identity' });
        await expect(pending).resolves.toBeNull();
        expect(setServerProfileIdentityForUrlMock).not.toHaveBeenCalled();
    });

});
