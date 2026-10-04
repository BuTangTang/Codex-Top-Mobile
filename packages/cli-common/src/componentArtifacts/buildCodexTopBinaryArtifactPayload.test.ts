import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import cliDistBuildManifest from '../../cliDistBuildManifest.cjs';
import { buildCliBinaryArtifactPayload } from './buildCliBinaryArtifactPayload.js';
import { publishCodexTopPayload } from './buildCodexTopBinaryArtifactPayload.js';
import { copyCodexTopRuntimeAssets } from './copyCodexTopRuntimeAssets.js';

vi.mock('./copyCodexTopRuntimeAssets.js', () => ({ copyCodexTopRuntimeAssets: vi.fn(async () => {}) }));
const roots: string[] = [];
const target = { bunTarget: 'bun-darwin-arm64', os: 'darwin', arch: 'arm64', exeExt: '' };
async function file(path: string, text: string) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); }
async function fixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), 'codextop-artifact-'));
  roots.push(repoRoot);
  const cliDir = join(repoRoot, 'apps/cli');
  await file(join(repoRoot, 'package.json'), '{}');
  await file(join(repoRoot, 'yarn.lock'), 'fixture lock');
  await file(join(cliDir, 'tsconfig.json'), '{}');
  await file(join(cliDir, 'package.json'), JSON.stringify({ name: 'fixture', bundledDependencies: [] }));
  await file(join(cliDir, 'src/index.ts'), 'original default source');
  await file(join(cliDir, 'dist/index.mjs'), 'original default dist');
  await file(join(cliDir, 'scripts/buildCodexTopBundle.mjs'), 'synthetic bundle owner');
  await file(join(cliDir, 'scripts/build.mjs'), `
    import { cp, mkdtemp, rm } from 'node:fs/promises';
    import { join } from 'node:path';
    export async function createImmutableBuildSource({packageRoot}) {
      const snapshot = await mkdtemp(join(packageRoot, '.snapshot-'));
      await cp(join(packageRoot, 'src'), join(snapshot, 'src'), {recursive:true});
      await cp(join(packageRoot, 'package.json'), join(snapshot, 'package.json'));
      await cp(join(packageRoot, 'tsconfig.json'), join(snapshot, 'tsconfig.json'));
      return {packageRoot:snapshot, cleanup:()=>rm(snapshot,{recursive:true})};
    }
  `);
  const payloadDir = join(repoRoot, 'payload');
  await file(join(payloadDir, 'previous'), 'valid previous payload');
  return { repoRoot, cliDir, payloadDir };
}
function dependencies() {
  return {
    commandProbe: (command: string) => command === 'bun',
    ensureWorkspacePackagesBuiltByName: async () => ({ ok: true, built: [], skipped: [] }),
    runCommand: vi.fn(async (_command: string, args: string[]) => {
      await file(join(args[2], 'index.mjs'), 'import "./child.mjs";');
      await file(join(args[2], 'child.mjs'), 'export const test = 1;');
      await file(join(args[2], '../runtime/bun'), 'synthetic runtime');
      await file(args[4], JSON.stringify({ inputs: { [join(args[1], 'src/index.ts')]: {} }, outputs: {}, codexTopBuildRuntime: { version: '1.4.2', revision: 'synthetic-revision', sha256: 'a'.repeat(64), bytes: 17 } }));
    }),
    compileBinary: vi.fn(async (params: { outfile: string }) => { await file(params.outfile, 'synthetic compiled executable'); }),
  };
}
afterEach(async () => {
  vi.mocked(copyCodexTopRuntimeAssets).mockReset().mockResolvedValue(undefined);
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('explicit Codex Top artifact generation', () => {
  it('publishes a complete product generation with original manifests while leaving default sources and dist intact', async () => {
    const fixturePaths = await fixture();
    const deps = dependencies();
    const result = await buildCliBinaryArtifactPayload({ ...fixturePaths, ...deps, target, artifactProfile: 'codex-top', releaseVersion: '1.0.0+codextop.90' });
    expect(result).toEqual({ executableName: 'happier', entrypoint: 'happier' });
    expect(await readFile(join(fixturePaths.cliDir, 'src/index.ts'), 'utf8')).toBe('original default source');
    expect(await readFile(join(fixturePaths.cliDir, 'dist/index.mjs'), 'utf8')).toBe('original default dist');
    const entrypoint = join(fixturePaths.payloadDir, 'package-dist/index.mjs');
    expect(cliDistBuildManifest.readCliDistBuildManifest(entrypoint).ok).toBe(true);
    expect(cliDistBuildManifest.readCliRuntimeAssetIntegrity({ runtimeRoot: fixturePaths.payloadDir, relativePath: 'runtime/bun', entrypoint }).ok).toBe(true);
    expect(JSON.parse(await readFile(join(fixturePaths.payloadDir, 'product-profile.json'), 'utf8'))).toMatchObject({ id: 'codex-top', buildVersion: '1.0.0+codextop.90' });
    expect(deps.compileBinary).not.toHaveBeenCalled();
    expect(await readFile(join(fixturePaths.payloadDir, 'happier'), 'utf8')).toContain('exec "$basedir/runtime/bun"');
    expect((await readdir(fixturePaths.cliDir)).some(name => name.startsWith('.snapshot-'))).toBe(false);
  });

  it.each(['bundle', 'assets'] as const)('keeps the prior payload and removes temporary snapshots after %s failure', async (phase) => {
    const paths = await fixture();
    const deps = dependencies();
    if (phase === 'bundle') deps.runCommand.mockRejectedValueOnce(new Error('bundle failure'));
    if (phase === 'assets') vi.mocked(copyCodexTopRuntimeAssets).mockRejectedValueOnce(new Error('asset failure'));
    await expect(buildCliBinaryArtifactPayload({ ...paths, ...deps, target, artifactProfile: 'codex-top' })).rejects.toThrow('failure');
    expect(await readFile(join(paths.payloadDir, 'previous'), 'utf8')).toBe('valid previous payload');
    expect((await readdir(paths.repoRoot)).some(name => name.startsWith('.codextop-'))).toBe(false);
    expect((await readdir(paths.cliDir)).some(name => name.startsWith('.snapshot-'))).toBe(false);
  });

  it('rejects unvalidated targets before invoking any build or replacing the previous payload', async () => {
    const paths = await fixture();
    const deps = dependencies();
    await expect(buildCliBinaryArtifactPayload({ ...paths, ...deps, target: { ...target, arch: 'x64' }, artifactProfile: 'codex-top' })).rejects.toThrow();
    expect(deps.runCommand).not.toHaveBeenCalled();
    expect(await readFile(join(paths.payloadDir, 'previous'), 'utf8')).toBe('valid previous payload');
  });

  it('restores the previous generation if the final rename cannot publish', async () => {
    const paths = await fixture();
    await expect(publishCodexTopPayload(join(paths.repoRoot, 'missing-stage'), paths.payloadDir)).rejects.toThrow();
    expect(await readFile(join(paths.payloadDir, 'previous'), 'utf8')).toBe('valid previous payload');
  });
});
