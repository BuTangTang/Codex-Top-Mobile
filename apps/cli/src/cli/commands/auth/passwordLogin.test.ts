import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPasswordAuthParameters, derivePasswordKeys, sealPasswordAccountSecret } from '@happier-dev/protocol';
import nacl from 'tweetnacl';
import { configuration, reloadConfiguration } from '@/configuration';
import { readCredentials, readSettings, updateSettings } from '@/persistence';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleText } from '@/testkit/logger/captureOutput';
import { handleAuthPasswordLogin } from './passwordLogin';

const scope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_ACTIVE_SERVER_ID']);
afterEach(() => { scope.restore(); reloadConfiguration(); vi.unstubAllGlobals(); process.exitCode = undefined; });
/** 合成账号使用真实 KDF 与封套，HTTP 是唯一替代边界。 */
async function responseFixture(accountId: string) {
  const parameters = createPasswordAuthParameters((n) => new Uint8Array(n).fill(8));
  const seed = new Uint8Array(32).fill(7);
  const publicKey = Buffer.from(nacl.sign.keyPair.fromSeed(seed).publicKey).toString('hex');
  const keys = await derivePasswordKeys('test-only-password', parameters);
  const envelope = sealPasswordAccountSecret({ credentialId: parameters.credentialId, accountId, publicKey, secret: seed, wrappingKey: keys.wrappingKey, randomBytes: (n) => new Uint8Array(n).fill(6) });
  return { parameters, response: { accountId, publicKey, envelope, token: `header.${Buffer.from(JSON.stringify({ sub: accountId })).toString('base64url')}.synthetic` }, seed };
}
describe('password login CLI', () => {
  it('uses the existing credential owner and emits only non-secret status', async () => {
    await withTempDir('password-cli-', async (home) => {
      scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: 'https://synthetic.test', HAPPIER_ACTIVE_SERVER_ID: 'synthetic' }); reloadConfiguration();
      const fixture = await responseFixture('account-a');
      const request = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/parameters') ? fixture.parameters : url.endsWith('/profile') ? { id: 'account-a' } : fixture.response)));
      vi.stubGlobal('fetch', request);
      const output = captureConsoleText();
      try {
        await handleAuthPasswordLogin(['--json'], Readable.from([JSON.stringify({ loginName: 'Alice', password: 'test-only-password' })]));
        expect(JSON.parse(output.text())).toMatchObject({ ok: true, kind: 'auth_password_login', data: { accountId: 'account-a', loginName: 'alice' } });
        const stored = await readCredentials();
        expect(stored?.token).toBe(fixture.response.token);
        expect(stored?.encryption.type).toBe('legacy');
        expect(output.text()).not.toContain(fixture.response.token);
        expect(output.text()).not.toContain('test-only-password');
        expect((await readSettings()).passwordAccountBinding?.accountId).toBe('account-a');
      } finally { output.restore(); }
    });
  });
  it('refuses a different source owner after local logout, including a server alias', async () => {
    await withTempDir('password-cli-binding-', async (home) => {
      scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: 'https://synthetic.test', HAPPIER_ACTIVE_SERVER_ID: 'new-alias' }); reloadConfiguration();
      await updateSettings((settings) => ({ ...settings, passwordAccountBinding: { accountId: 'original', loginName: 'original', serverKey: 'https://synthetic.test' } }));
      const fixture = await responseFixture('different');
      vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/parameters') ? fixture.parameters : url.endsWith('/profile') ? { id: 'different' } : fixture.response))));
      const output = captureConsoleText();
      try {
        await handleAuthPasswordLogin(['--json'], Readable.from([JSON.stringify({ loginName: 'new', password: 'test-only-password' })]));
        expect(JSON.parse(output.text())).toMatchObject({ ok: false, error: { code: 'source_account_conflict' } });
        expect(await readCredentials()).toBeNull();
        expect((await readSettings()).passwordAccountBinding?.accountId).toBe('original');
      } finally { output.restore(); }
    });
  });
  it('rejects cleartext remote transport before reading or transmitting password', async () => {
    await withTempDir('password-cli-http-', async (home) => {
      scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_SERVER_URL: 'http://remote.example.test', HAPPIER_ACTIVE_SERVER_ID: 'synthetic' }); reloadConfiguration();
      const request = vi.fn(); vi.stubGlobal('fetch', request);
      const output = captureConsoleText();
      try {
        await handleAuthPasswordLogin(['--json'], Readable.from(['{}']));
        expect(JSON.parse(output.text())).toMatchObject({ ok: false, error: { code: 'insecure_transport' } });
        expect(request).not.toHaveBeenCalled(); expect(await readCredentials()).toBeNull();
      } finally { output.restore(); }
    });
  });
});
