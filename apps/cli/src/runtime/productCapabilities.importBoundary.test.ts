import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const cliRoot = fileURLToPath(new URL('../../', import.meta.url));
const productDescriptor = `${cliRoot}src/runtime/profiles/codexTopCapabilities.ts`;
const productAliases = {
  '@/daemon/memory/daemonMemoryCapability': productDescriptor,
  '@/rpc/handlers/sessionToolCapabilities': productDescriptor,
  '@/runtime/productCapabilities': productDescriptor,
};

/** 只编译真实源码依赖图，不执行后台、账号或原生工具。 */
async function readModules(product: boolean): Promise<readonly string[]> {
  const result = await build({
    absWorkingDir: cliRoot,
    entryPoints: [`${cliRoot}src/daemon/startDaemon.ts`],
    bundle: true, write: false, metafile: true,
    platform: 'node', format: 'esm', packages: 'external',
    alias: { ...(product ? productAliases : {}), '@': `${cliRoot}src` },
    logLevel: 'silent',
  });
  return Object.keys(result.metafile!.inputs);
}

describe('product optional capabilities import boundary', () => {
  it('excludes unavailable runtime owners while retaining the complete daemon/session owners', async () => {
    const modules = await readModules(true);
    const forbidden = modules.filter((path) =>
      path === 'src/daemon/memory/memoryWorker.ts'
      || path === 'src/api/machine/rpcHandlers.memory.ts'
      || path.includes('/deepIndex/embeddings/')
      || path.startsWith('src/integrations/difftastic/')
      || path.startsWith('src/integrations/ripgrep/'));
    expect(forbidden).toEqual([]);
    expect(modules).toEqual(expect.arrayContaining([
      'src/daemon/startDaemonCore.ts',
      'src/daemon/sessions/stopSession.ts',
      'src/api/machine/rpcHandlers.directSessions.ts',
      'src/api/session/sessionClient.ts',
      'src/transfers/rpc/registerSessionTransferRpcHandlers.ts',
    ]));
  });

  it('keeps the default memory and session tools owners reachable', async () => {
    expect(await readModules(false)).toEqual(expect.arrayContaining([
      'src/daemon/memory/memoryWorker.ts',
      'src/api/machine/rpcHandlers.memory.ts',
      'src/integrations/difftastic/index.ts',
      'src/integrations/ripgrep/index.ts',
    ]));
  });
});
