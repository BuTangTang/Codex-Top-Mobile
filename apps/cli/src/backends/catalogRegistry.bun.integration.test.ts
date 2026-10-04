import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const bunExecutable = process.env.HAPPIER_TEST_BUN_EXECUTABLE?.trim() || 'bun';
const bunAvailable = spawnSync(bunExecutable, ['--version'], { encoding: 'utf8' }).status === 0;

describe('Codex Top catalog registry build boundary', () => {
  it.skipIf(!bunAvailable && !process.env.CI)('uses the real catalog and Codex entry through a compiled registry alias', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'happier-catalog-registry-'));
    const cliRoot = fileURLToPath(new URL('../../', import.meta.url));
    const sourceRoot = join(cliRoot, 'src');
    const entrypoint = join(directory, 'entry.ts');
    const buildScript = join(directory, 'build.ts');
    const binary = join(directory, 'catalog-probe');
    const metadataPath = join(directory, 'metadata.json');
    const home = join(directory, 'home');
    try {
      await mkdir(home);
      await writeFile(entrypoint, `
import assert from 'node:assert/strict';
import * as catalog from ${JSON.stringify(join(sourceRoot, 'backends/catalog.ts'))};
import { AGENTS as registryAgents } from '@/backends/catalogRegistry';
import { agent as codex } from ${JSON.stringify(join(sourceRoot, 'backends/codex/index.ts'))};
// 保留全部真实公开入口，防止未调用的 catalog 能力被优化器消除。
Object.defineProperty(globalThis, '__catalogRegistryProbe', { value: catalog });
assert.deepEqual(Object.keys(catalog.AGENTS), ['codex']);
assert.equal(catalog.AGENTS, registryAgents);
assert.equal(catalog.requireCatalogEntry('codex'), codex);
assert.equal(catalog.resolveCatalogAgentId(), 'codex');
assert.equal(catalog.resolveCatalogAgentId(null), 'codex');
assert.equal(catalog.resolveAgentCliSubcommand(), 'codex');
for (const input of ['claude', 'unknown', '', 'CODEX', 'codex-extra', '__proto__']) {
  assert.throws(() => catalog.resolveCatalogAgentId(input), /Unsupported catalog agent/);
  assert.match(catalog.getCatalogBackendTargetSupportError(input, undefined), /Unsupported catalog agent/);
}
for (const rawAgent of [undefined, null, 'codex']) {
  for (const target of [undefined, null, { kind: 'builtInAgent', agentId: 'codex' }]) {
    assert.equal(catalog.getCatalogBackendTargetSupportError(rawAgent, target), null);
  }
}
for (const rawAgent of [0, false, {}, ['codex']]) {
  assert.match(catalog.getCatalogBackendTargetSupportError(rawAgent, undefined), /Unsupported catalog agent/);
}
for (const target of [
  '', 0, false, [], {}, { kind: 'configuredAcpBackend', backendId: 'example' },
  { kind: 'builtInAgent' }, { kind: 'builtInAgent', agentId: 'claude' },
  { kind: 'builtInAgent', agentId: 'codex-extra' }, { kind: 'unknown', agentId: 'codex' },
]) {
  assert.match(catalog.getCatalogBackendTargetSupportError('codex', target), /Unsupported backend target/);
}
assert.match(catalog.getCatalogBackendTargetSupportError('claude', { kind: 'builtInAgent', agentId: 'codex' }), /Unsupported catalog agent/);
await assert.rejects(catalog.getDirectSessionProviderOps('claude'), /Missing direct-session provider ops for claude/);
const directOps = await catalog.getDirectSessionProviderOps('codex');
assert.equal(directOps, await catalog.getDirectSessionProviderOps('codex'));
assert.equal(directOps, (await import(${JSON.stringify(join(sourceRoot, 'backends/codex/directSessions/providerOps.ts'))})).codexDirectSessionProviderOps);
assert.equal(await catalog.getSessionGoalControlAdapter('codex'), await codex.getSessionGoalControlAdapter());
console.log('catalog-registry-runtime-pass');
`);
      await writeFile(buildScript, `
import { writeFile } from 'node:fs/promises';
const result = await Bun.build({
  entrypoints: [${JSON.stringify(entrypoint)}], target: 'bun', format: 'esm',
  compile: { outfile: ${JSON.stringify(binary)} }, metafile: true,
  minify: { whitespace: true, syntax: true, identifiers: false },
  external: ['@huggingface/transformers', 'node-pty', '@homebridge/node-pty-prebuilt-multiarch', 'sharp'],
  plugins: [{ name: 'codex-top-registry', setup(build) {
    build.onResolve({ filter: /^@\\/backends\\/catalogRegistry$/ }, () => ({
      path: ${JSON.stringify(join(sourceRoot, 'backends/catalogRegistry.codexTop.ts'))},
    }));
  }}],
});
if (!result.success) throw new AggregateError(result.logs, 'Registry probe build failed');
await writeFile(${JSON.stringify(metadataPath)}, JSON.stringify(result.metafile));
`);
      const environment = { ...process.env, HAPPIER_HOME_DIR: home, HAPPIER_FEATURE_POLICY_ENV: '' };
      await execFileAsync(bunExecutable, [buildScript], { cwd: cliRoot, env: environment });
      const { stdout } = await execFileAsync(binary, [], { cwd: cliRoot, env: environment });
      expect(stdout.trim()).toBe('catalog-registry-runtime-pass');
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { inputs: Record<string, unknown> };
      const modules = Object.keys(metadata.inputs).map((path) => path.replaceAll('\\', '/'));
      expect(modules.some((path) => path.endsWith('/backends/catalog.ts'))).toBe(true);
      expect(modules.some((path) => path.endsWith('/backends/catalogRegistry.codexTop.ts'))).toBe(true);
      expect(modules.some((path) => path.endsWith('/backends/codex/index.ts'))).toBe(true);
      expect(modules.some((path) => path.endsWith('/backends/directSessions/createDirectSessionProviderOpsResolver.ts'))).toBe(true);
      expect(modules.some((path) => path.endsWith('/backends/catalogHookPromiseCache.ts'))).toBe(true);
      expect(modules.some((path) => path.endsWith('/backends/codex/directSessions/providerOps.ts'))).toBe(true);
      expect(modules.some((path) => path.endsWith('/backends/catalogRegistry.ts'))).toBe(false);
      expect(modules.filter((path) => /\/backends\/(auggie|agy|claude|copilot|cursor|devin|gemini|grok|kimi|kilo|opencode|pi|qwen)\/index\.ts$/.test(path))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
