import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';
import { createPasswordAuthParameters, derivePasswordKeys, sealPasswordAccountSecret } from '@happier-dev/protocol';
import { encodeBase64 } from '@/encryption/base64';
import { passwordLogin } from './passwordLogin';

const network = vi.hoisted(() => ({ fetch: vi.fn(), snapshot: { serverId: 'a', serverUrl: 'https://a.test', generation: 1 } }));
vi.mock('@/sync/http/client', () => ({ serverFetch: (...args: unknown[]) => network.fetch(...args) }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => network.snapshot }));
const parameters = createPasswordAuthParameters((n) => new Uint8Array(n).fill(7));
const seed = new Uint8Array(32).fill(4);
const publicKey = Buffer.from(nacl.sign.keyPair.fromSeed(seed).publicKey).toString('hex');
let envelope: ReturnType<typeof sealPasswordAccountSecret>;
beforeAll(async () => {
    const keys = await derivePasswordKeys(' test password ', parameters);
    envelope = sealPasswordAccountSecret({ credentialId: parameters.credentialId, accountId: 'test-account', publicKey, secret: seed, wrappingKey: keys.wrappingKey, randomBytes: (n) => new Uint8Array(n).fill(3) });
});
beforeEach(() => {
    network.snapshot = { serverId: 'a', serverUrl: 'https://a.test', generation: 1 };
    network.fetch.mockReset();
    network.fetch.mockResolvedValueOnce(new Response(JSON.stringify(parameters)));
    network.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ token: 'synthetic-token', accountId: 'test-account', publicKey, envelope })));
    network.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'test-account' })));
});
describe('passwordLogin', () => {
    it('rejects remote HTTP before transmitting any credential', async () => {
        network.snapshot = { ...network.snapshot, serverUrl: 'http://remote.test' };
        await expect(passwordLogin({ loginName: 'colleague', password: 'test', expectedActiveServerSnapshot: network.snapshot })).rejects.toMatchObject({ code: 'unavailable' });
        expect(network.fetch).not.toHaveBeenCalled();
    });

    it('decrypts and validates the account seed without sending password or seed', async () => {
        const result = await passwordLogin({ loginName: 'colleague', password: ' test password ', expectedActiveServerSnapshot: network.snapshot });
        expect(result).toEqual({ token: 'synthetic-token', secret: encodeBase64(seed, 'base64url'), loginName: 'colleague' });
        expect(network.fetch.mock.calls[0][0]).toBe('https://a.test/v1/auth/password/parameters');
        const body = JSON.parse(network.fetch.mock.calls[1][1].body);
        expect(Object.keys(body).sort()).toEqual(['credentialId', 'loginName', 'loginSecret']);
        expect(JSON.stringify(body)).not.toContain(' test password ');
    });
    it('rejects a valid envelope paired with another authenticated account token', async () => {
        network.fetch.mockReset().mockResolvedValueOnce(new Response(JSON.stringify(parameters))).mockResolvedValueOnce(new Response(JSON.stringify({ token: 'synthetic-token', accountId: 'test-account', publicKey, envelope }))).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'different-account' })));
        await expect(passwordLogin({ loginName: 'colleague', password: ' test password ', expectedActiveServerSnapshot: network.snapshot })).rejects.toThrow();
    });
    it('rejects wrong passwords even if a transport returns a token', async () => {
        await expect(passwordLogin({ loginName: 'colleague', password: 'wrong', expectedActiveServerSnapshot: network.snapshot })).rejects.toThrow();
    });
    it('stops before sending proof when parameter response changes server generation', async () => {
        const snapshot = network.snapshot;
        network.fetch.mockReset().mockImplementation(async () => {
            network.snapshot = { ...snapshot, generation: 2 };
            return new Response(JSON.stringify(parameters));
        });
        await expect(passwordLogin({ loginName: 'colleague', password: 'test', expectedActiveServerSnapshot: snapshot })).rejects.toThrow('Authentication cancelled');
        expect(network.fetch).toHaveBeenCalledTimes(1);
    });
    it('does not return credentials after a screen loses focus during login', async () => {
        let active = true;
        network.fetch.mockReset().mockResolvedValueOnce(new Response(JSON.stringify(parameters))).mockImplementationOnce(async () => {
            active = false;
            return new Response(JSON.stringify({ token: 'synthetic-token', accountId: 'test-account', publicKey, envelope }));
        });
        await expect(passwordLogin({ loginName: 'colleague', password: ' test password ', expectedActiveServerSnapshot: network.snapshot, isStillValid: () => active })).rejects.toThrow('Authentication cancelled');
    });
    it('reports throttling without surfacing a server response body', async () => {
        network.fetch.mockReset().mockResolvedValue(new Response('private diagnostic', { status: 429 }));
        await expect(passwordLogin({ loginName: 'colleague', password: 'test', expectedActiveServerSnapshot: network.snapshot })).rejects.toMatchObject({ code: 'rateLimited' });
    });
});
