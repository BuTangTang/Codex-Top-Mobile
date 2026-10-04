import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('machineRegistrationRetryPolicy import boundary', () => {
  it('uses the canonical error leaf without pulling in API capabilities', async () => {
    // 保留真实重试判断依赖，避免仅导入策略就加载整个机器与会话能力图。
    const cliRoot = fileURLToPath(new URL('../../', import.meta.url));
    const result = await build({
      absWorkingDir: cliRoot,
      entryPoints: [fileURLToPath(new URL('./machineRegistrationRetryPolicy.ts', import.meta.url))],
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
      'src/api/machine/machineRegistrationErrors.ts',
      'src/api/client/httpStatusError.ts',
    ]));
    expect(modules.filter((module) => [
      'src/api/api.ts',
      'src/api/apiMachine.ts',
      'src/api/session/sessionClient.ts',
      'src/api/machine/rpcHandlers.ts',
      'src/backends/catalog.ts',
    ].includes(module))).toEqual([]);
  });
});
