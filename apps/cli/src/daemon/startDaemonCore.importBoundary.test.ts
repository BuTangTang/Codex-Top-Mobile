import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/** 读取真实源码闭包；不执行入口、不启动后台或访问账号。 */
async function readModules(entry: string): Promise<readonly string[]> {
  const cliRoot = fileURLToPath(new URL('../../', import.meta.url));
  const result = await build({
    absWorkingDir: cliRoot,
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, write: false, metafile: true,
    platform: 'node', format: 'esm', packages: 'external',
    alias: { '@': `${cliRoot}src` }, logLevel: 'silent',
  });
  return Object.keys(result.metafile!.inputs);
}

describe('daemon lifecycle import boundary', () => {
  it('retains lifecycle owners without reaching the default capability factory', async () => {
    const modules = await readModules('./startDaemonCore.ts');
    expect(modules).toEqual(expect.arrayContaining([
      'src/persistence.ts',
      'src/daemon/lifecycle/runMachineBootstrap.ts',
      'src/daemon/lifecycle/shutdown.ts',
      'src/daemon/lifecycle/publishShutdownState.ts',
    ]));
    const forbidden = [
      'src/daemon/startDaemon.ts', 'src/backends/catalog.ts',
      'src/api/api.ts', 'src/api/apiMachine.ts',
      'src/daemon/controlServer.ts', 'src/daemon/lifecycle/heartbeat.ts',
      'src/rpc/handlers/registerSessionHandlers.ts',
      'src/daemon/memory/memoryWorker.ts',
      'src/daemon/automation/automationWorker.ts',
    ];
    expect(modules.filter((path) => forbidden.includes(path))).toEqual([]);
  });

  it('keeps the complete default factory wired to the same lifecycle', async () => {
    const modules = await readModules('./startDaemon.ts');
    expect(modules).toEqual(expect.arrayContaining([
      'src/daemon/startDaemonCore.ts', 'src/backends/catalog.ts',
      'src/api/api.ts', 'src/api/apiMachine.ts',
      'src/daemon/controlServer.ts', 'src/daemon/lifecycle/heartbeat.ts',
      'src/daemon/memory/memoryWorker.ts', 'src/daemon/automation/automationWorker.ts',
    ]));
  });
});
