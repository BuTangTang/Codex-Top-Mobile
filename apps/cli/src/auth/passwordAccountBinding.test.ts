import { afterEach, describe, expect, it } from 'vitest';
import { reloadConfiguration } from '@/configuration';
import { updateSettings } from '@/persistence';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { isProductAccountBindingValid } from './passwordAccountBinding';
const scope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_PRODUCT_MODE']);
afterEach(() => { scope.restore(); reloadConfiguration(); });
describe('product source account binding', () => {
  it('fails closed for missing and different identity but preserves legacy behavior', async () => {
    await withTempDir('binding-', async (home) => {
      scope.patch({ HAPPIER_HOME_DIR: home, HAPPIER_PRODUCT_MODE: 'codextop' }); reloadConfiguration();
      const input = { accountId: 'a', serverUrl: 'https://synthetic.test' };
      expect(await isProductAccountBindingValid(input)).toBe(false);
      await updateSettings((settings) => ({ ...settings, passwordAccountBinding: { ...input, loginName: 'alice', serverKey: input.serverUrl } }));
      expect(await isProductAccountBindingValid(input)).toBe(true);
      expect(await isProductAccountBindingValid({ ...input, accountId: 'b' })).toBe(false);
      expect(await isProductAccountBindingValid({ ...input, serverUrl: 'https://other.test' })).toBe(false);
      scope.patch({ HAPPIER_PRODUCT_MODE: undefined });
      expect(await isProductAccountBindingValid({ ...input, accountId: 'b' })).toBe(true);
    });
  });
});
