import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';

const cliRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** 编译并执行真实命令；只添加模块求值观察点，内部实现和依赖保持原样。 */
async function observeColdCommands(): Promise<{
  imported: string[];
  helped: string[];
  repaired: string[];
  repairError: string;
  inspected: string[];
  freshEnvironment: boolean;
}> {
  return await withTempDir('daemon-cold-import-', async (directory) => {
    const entry = join(directory, 'commands.mjs');
    const modules = new Map([
      [join(cliRoot, 'src/ui/doctor.ts'), 'doctor'],
      [join(cliRoot, 'src/cli/commands/serviceRepair/handleServiceRepairCliCommand.ts'), 'repair'],
    ]);
    await build({
      absWorkingDir: cliRoot,
      stdin: {
        contents: `
          import { handleDaemonCliCommand } from '@/cli/commands/daemon';
          import { configuration, reloadConfiguration } from '@/configuration';
          const imported = [...globalThis.__daemonColdEvaluations ?? []];
          await handleDaemonCliCommand({args:['daemon','start-sync','--help'],rawArgv:[],terminalRuntime:null});
          const helped = [...globalThis.__daemonColdEvaluations ?? []];
          let repairError = '';
          try {
            await handleDaemonCliCommand({args:['daemon','service','repair','--mode','invalid'],rawArgv:[],terminalRuntime:null});
          } catch(error) { repairError = error instanceof Error ? error.message : String(error); }
          const repaired = [...globalThis.__daemonColdEvaluations ?? []];
          const { getEnvironmentInfo } = await import('@/ui/doctor');
          const first = getEnvironmentInfo();
          process.env.PWD = 'synthetic-next-pwd';
          process.env.USER = 'synthetic-next-user';
          process.argv = ['synthetic-executable', 'synthetic-next-argument'];
          process.chdir(process.env.HOME);
          process.env.HAPPIER_SERVER_URL = 'https://next.example.test';
          reloadConfiguration();
          const second = getEnvironmentInfo();
          const freshEnvironment = first !== second && first.processArgv !== second.processArgv
            && second.PWD === 'synthetic-next-pwd' && second.user === 'synthetic-next-user'
            && second.processArgv === process.argv && second.workingDirectory === process.cwd()
            && first.serverUrl !== second.serverUrl && second.serverUrl === configuration.serverUrl && second.happyDir === configuration.happyHomeDir
            && second.logsDir === configuration.logsDir && second.processPid === process.pid
            && second.nodeVersion === process.version && second.platform === process.platform && second.arch === process.arch;
          console.log('COLD_IMPORT_RESULT=' + JSON.stringify({imported,helped,repaired,repairError,
            inspected:[...globalThis.__daemonColdEvaluations ?? []],freshEnvironment}));
        `,
        resolveDir: join(cliRoot, 'src'), loader: 'ts',
      },
      bundle: true, outfile: entry, platform: 'node', format: 'esm', packages: 'external',
      alias: { '@': join(cliRoot, 'src') }, logLevel: 'silent',
      plugins: [{
        name: 'observe-real-module-evaluation',
        setup(builder) {
          // 观察真实模块的初始化时机，不替换导出、内部逻辑或命令行为。
          builder.onLoad({ filter: /(?:doctor|handleServiceRepairCliCommand)\.ts$/ }, async ({ path }) => {
            const label = modules.get(path);
            if (!label) return;
            return { contents: `(globalThis.__daemonColdEvaluations ??= []).push(${JSON.stringify(label)});\n${await readFile(path, 'utf8')}`, loader: 'ts' };
          });
        },
      }],
    });
    const stdout = execFileSync(process.execPath, [entry], {
      cwd: directory, encoding: 'utf8', timeout: 30_000,
      env: {
        PATH: process.env.PATH, HOME: directory, HAPPIER_HOME_DIR: directory,
        HAPPIER_SERVER_URL: 'https://relay.example.test', HAPPIER_WEBAPP_URL: 'https://web.example.test',
        HAPPIER_TAILSCALE_AUTO_PUBLIC_URL: '0',
      },
    });
    const result = stdout.split('\n').find((line) => line.startsWith('COLD_IMPORT_RESULT='));
    if (!result) throw new Error('Missing actual command import observation');
    return JSON.parse(result.slice('COLD_IMPORT_RESULT='.length));
  }, cliRoot);
}

describe('daemon diagnostic cold imports', () => {
  it('loads repair only when requested and keeps environment reads live through the public doctor export', async () => {
    const observed = await observeColdCommands();
    expect(observed.imported).toEqual([]);
    expect(observed.helped).toEqual([]);
    expect(observed.repaired).toEqual(['repair']);
    expect(observed.repairError).toContain('Invalid --mode value');
    expect(observed.inspected).toEqual(['repair', 'doctor']);
    expect(observed.freshEnvironment).toBe(true);
  });
});
