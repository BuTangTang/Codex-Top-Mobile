import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('heartbeatCore import boundary', () => {
  it('keeps the shared lifecycle without loading default maintenance capabilities', async () => {
    // 只观察真实入口的源码依赖，不启动后台或读取账号数据。
    const cliRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const result = await build({
      absWorkingDir: cliRoot,
      entryPoints: [fileURLToPath(new URL('./heartbeatCore.ts', import.meta.url))],
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
      'src/persistence.ts',
      'src/daemon/sessions/cleanupPidSessionResources.ts',
      'src/daemon/sessionRunnerProcessIdentity.ts',
      'src/daemon/sessionRegistry.ts',
      'src/daemon/resolveComparableCliVersion.ts',
    ]));
    const defaultCapabilities = [
      'src/daemon/lifecycle/heartbeat.ts',
      'src/daemon/lifecycle/requestDaemonSelfRestart.ts',
      'src/daemon/executionRunRegistry.ts',
      'src/workspaces/replication/state/workspaceReplicationGc.ts',
      'src/session/handoff/prepare/sessionHandoffPrepareTargetJobStore.ts',
      'src/daemon/sessions/onChildExited.ts',
      'src/api/api.ts',
      'src/api/apiMachine.ts',
      'src/backends/catalog.ts',
    ];
    expect(modules.filter((module) => defaultCapabilities.includes(module))).toEqual([]);
  });
});
