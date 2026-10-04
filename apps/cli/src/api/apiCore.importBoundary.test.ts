import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('ApiClientCore import boundary', () => {
  it('keeps machine identity and push without importing default API capabilities', async () => {
    // 观察真实入口源码图；不执行API、不删schema，也不假定外部协议包已tree-shake。
    const cliRoot = fileURLToPath(new URL('../../', import.meta.url));
    const result = await build({
      absWorkingDir: cliRoot,
      entryPoints: [fileURLToPath(new URL('./apiCore.ts', import.meta.url))],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      alias: { '@': `${cliRoot}src` },
      logLevel: 'silent',
    });
    const modules = Object.keys(result.metafile!.inputs);
    expect(modules).toEqual(expect.arrayContaining([
      'src/api/pushNotifications.ts',
      'src/api/client/encryptionKey.ts',
      'src/api/client/offlineErrors.ts',
      'src/daemon/machineIdentity/resolveMachineRegistrationIdentity.ts',
      'src/daemon/machineIdentity/machineReplacementCandidates.ts',
      'src/daemon/identity/proof.ts',
      'src/daemon/identity/store.ts',
      'src/api/machine/machineRegistrationErrors.ts',
    ]));
    const defaultCapabilities = [
      'src/api/api.ts',
      'src/api/session/sessionClient.ts',
      'src/api/apiMachine.ts',
      'src/api/apiMachineCore.ts',
      'src/api/connectedServices/connectedServiceCredentialApi.ts',
      'src/api/connectedServices/scmConnectedAccountCredentialResolver.ts',
      'src/backends/catalog.ts',
    ];
    expect(modules.filter((module) => defaultCapabilities.includes(module))).toEqual([]);
  });
});
