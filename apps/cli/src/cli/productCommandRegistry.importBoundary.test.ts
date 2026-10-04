import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const cliRoot = fileURLToPath(new URL('../../', import.meta.url));

/** 观察真实源码图；外部包仍保留为 external，不把此证据当完整包体或运行验收。 */
async function readModules(entry: string, product: boolean): Promise<readonly string[]> {
  const descriptor = `${cliRoot}src/runtime/profiles/codexTopCapabilities.ts`;
  const result = await build({
    absWorkingDir: cliRoot, entryPoints: [`${cliRoot}${entry}`],
    bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', packages: 'external',
    alias: {
      ...(product ? {
        '@/backends/catalogRegistry': `${cliRoot}src/backends/catalogRegistry.codexTop.ts`,
        '@/runtime/productCapabilities': descriptor,
        '@/daemon/memory/daemonMemoryCapability': descriptor,
        '@/rpc/handlers/sessionToolCapabilities': descriptor,
      } : {}),
      '@': `${cliRoot}src`,
    },
    logLevel: 'silent',
  });
  return Object.keys(result.metafile!.inputs);
}

describe('product CLI composition import boundary', () => {
  it('keeps the shared dispatcher independent of the default command and catalog compositions', async () => {
    const modules = await readModules('src/cli/createCliDispatcher.ts', false);
    expect(modules).not.toContain('src/cli/commandRegistry.ts');
    expect(modules).not.toContain('src/backends/catalog.ts');
    expect(modules).not.toContain('src/cli/buildRootHelpText.ts');
  });

  it('uses genuine auth, daemon and managed Codex owners without importing default entry compositions', async () => {
    const modules = await readModules('src/product/codextop.ts', true);
    expect(modules).toEqual(expect.arrayContaining([
      'src/cli/runtime/runCliEntrypoint.ts', 'src/cli/createCliDispatcher.ts',
      'src/cli/commands/auth.ts', 'src/cli/commands/daemon.ts',
      'src/daemon/startDaemon.ts', 'src/daemon/startDaemonCore.ts',
      'src/backends/codex/cli/command.ts', 'src/backends/codex/runCodex.ts',
      'src/backends/catalogRegistry.codexTop.ts', 'src/api/session/sessionClient.ts',
      'src/runtime/profiles/codexTopCapabilities.ts',
    ]));
    expect(modules.filter((path) => [
      'src/index.ts', 'src/cli/dispatch.ts', 'src/cli/commandRegistry.ts',
      'src/backends/catalogRegistry.ts', 'src/cli/commands/pluginsCompatibility.ts',
      'src/cli/commands/capabilities.ts', 'src/cli/commands/self.ts',
    ].includes(path))).toEqual([]);
  });
});
