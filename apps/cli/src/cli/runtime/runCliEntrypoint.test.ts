import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '@/testkit/fs/tempDir';
import packageJson from '../../../package.json';

const cliRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** 编译真实入口并运行合成 HOME；较新泛用 runtime 只输出标记，不读账号或网络。 */
async function invokeEntrypoint(product: boolean, options: Readonly<{ tty?: boolean }> = {}): Promise<string> {
  return await withTempDir('entrypoint-policy-', async (root) => {
    const output = join(root, 'package-dist', 'index.mjs');
    const home = join(root, 'isolated-home');
    const runtime = join(home, 'runtime', 'node_modules', ...packageJson.name.split('/'));
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson));
    mkdirSync(home, { recursive: true });
    if (!options.tty) {
      mkdirSync(join(runtime, 'dist'), { recursive: true });
      writeFileSync(join(runtime, 'package.json'), JSON.stringify({ version: '99.0.0' }));
      writeFileSync(join(runtime, 'dist', 'index.mjs'), "console.log('synthetic-generic-runtime');\n");
    }
    const descriptor = join(cliRoot, 'src/runtime/profiles/codexTopCapabilities.ts');
    await build({
      absWorkingDir: cliRoot,
      entryPoints: [join(cliRoot, product ? 'src/product/codextop.ts' : 'src/index.ts')],
      bundle: true, outfile: output, platform: 'node', format: 'esm', packages: 'external',
      alias: {
        ...(product ? {
          '@/backends/catalogRegistry': join(cliRoot, 'src/backends/catalogRegistry.codexTop.ts'),
          '@/runtime/productCapabilities': descriptor,
          '@/daemon/memory/daemonMemoryCapability': descriptor,
          '@/rpc/handlers/sessionToolCapabilities': descriptor,
        } : {}),
        '@': join(cliRoot, 'src'),
      },
      logLevel: 'silent',
    });
    const launcher = join(root, 'tty-boundary.mjs');
    if (options.tty) {
      // 只替换外部 process spawn 边界，真实更新逻辑仍读取独立 HOME；禁止实际联网检查。
      writeFileSync(launcher, `import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
Object.defineProperty(process.stderr, 'isTTY', { value: true });
cp.spawn = (file, args) => { console.log('synthetic-self-check:' + JSON.stringify(args)); return { unref() {} }; };
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(output)}, '--help'];
await import(${JSON.stringify(pathToFileURL(output).href)});
`);
    }
    return execFileSync(process.execPath, options.tty ? [launcher] : [output, '--version'], {
      encoding: 'utf8', timeout: 30_000,
      env: {
        PATH: process.env.PATH, HOME: home, HAPPIER_HOME_DIR: home,
        HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable', HAPPIER_TAILSCALE_AUTO_PUBLIC_URL: '0',
      },
    });
  }, cliRoot);
}

describe('CLI entrypoint update ownership', () => {
  it('preserves default runtime reexec into a newer synthetic installation', async () => {
    expect(await invokeEntrypoint(false)).toContain('synthetic-generic-runtime');
  }, 60_000);

  it('keeps Codex Top in its App-owned runtime despite a newer generic HOME installation', async () => {
    const output = await invokeEntrypoint(true);
    expect(output.trim()).toBe(packageJson.version);
    expect(output).not.toContain('synthetic-generic-runtime');
  }, 60_000);

  it('keeps automatic self checks in the default CLI and excludes them from the App product', async () => {
    expect(await invokeEntrypoint(false, { tty: true })).toContain('"self","check","--quiet"');
    const product = await invokeEntrypoint(true, { tty: true });
    expect(product).toContain('Codex Top connection');
    expect(product).not.toContain('synthetic-self-check:');
  }, 60_000);
});
