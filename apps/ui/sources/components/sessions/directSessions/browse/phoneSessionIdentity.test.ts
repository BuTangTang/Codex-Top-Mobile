import { describe, expect, it } from 'vitest';
import { buildPhoneSessionIdentity } from './phoneSessionIdentity';

describe('phone history identity', () => {
    it('separates computer, account and source without relying on session titles', () => {
        const base = { serverId: 's', accountId: 'a', machineId: 'm', remoteSessionId: 'r', source: { kind: 'codexHome', home: 'user' } };
        expect(buildPhoneSessionIdentity(base)).toBe(buildPhoneSessionIdentity({ ...base, source: { home: 'user', kind: 'codexHome' } }));
        for (const changed of [{ machineId: 'm2' }, { accountId: 'a2' }, { serverId: 's2' }, { source: { kind: 'codexHome', home: 'user', homePath: '/other' } }]) {
            expect(buildPhoneSessionIdentity({ ...base, ...changed })).not.toBe(buildPhoneSessionIdentity(base));
        }
    });
});
