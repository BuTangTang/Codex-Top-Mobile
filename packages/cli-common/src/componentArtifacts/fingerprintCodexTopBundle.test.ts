import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { fingerprintCodexTopBundle } from './fingerprintCodexTopBundle.js';

const temporary: string[] = [];
const target = { bunTarget: 'bun-darwin-arm64', os: 'darwin', arch: 'arm64', exeExt: '' };

/** 测试输入全部在临时目录，package 声明及模块字节均使用合成内容。 */
async function file(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

/** 构造带内层模块类型与外层 exports 的依赖，区分“最近声明”遗漏。 */
async function fixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), 'codextop-fingerprint-'));
  temporary.push(repoRoot);
  const sourceRoot = join(repoRoot, 'apps/cli/.snapshot-first');
  const metafilePath = join(sourceRoot, 'metafile.json');
  const bundleScriptPath = join(repoRoot, 'apps/cli/scripts/buildCodexTopBundle.mjs');
  await file(join(repoRoot, 'package.json'), '{"workspaces":["apps/*"]}');
  await file(join(repoRoot, 'apps/cli/package.json'), '{"name":"cli","version":"1.0.0"}');
  await file(join(sourceRoot, 'package.json'), '{"name":"cli","version":"1.0.0"}');
  await file(join(sourceRoot, 'src/index.ts'), 'export const answer = 1;');
  await file(join(sourceRoot, 'tsconfig.json'), '{"compilerOptions":{"target":"ESNext"}}');
  await file(join(repoRoot, 'apps/cli/tsconfig.json'), '{"compilerOptions":{"target":"ESNext"}}');
  await file(join(repoRoot, 'yarn.lock'), 'synthetic-lockfile');
  await file(bundleScriptPath, 'await Bun.build({minify:true});');
  await file(join(repoRoot, 'node_modules/dependency/package.json'), '{"name":"dependency","version":"1.0.0","exports":"./dist/index.js"}');
  await file(join(repoRoot, 'node_modules/dependency/dist/package.json'), '{"type":"module"}');
  await file(join(repoRoot, 'node_modules/dependency/dist/index.js'), 'export const dep = 1;');
  await file(metafilePath, JSON.stringify({
    inputs: { 'apps/cli/.snapshot-first/src/index.ts': { bytes: 24 }, 'node_modules/dependency/dist/index.js': { bytes: 20 } },
    outputs: { 'index.mjs': { inputs: { 'apps/cli/.snapshot-first/src/index.ts': { bytesInOutput: 24 } } } },
    codexTopBuildRuntime: { version: '1.4.2', revision: 'synthetic-bun-revision', sha256: 'a'.repeat(64), bytes: 12345 },
  }));
  return { repoRoot, sourceRoot, metafilePath, profile: { id: 'codex-top', revision: 1, aliases: { '@/registry': 'src/registry.ts' } }, target, releaseVersion: '90', bundleScriptPath };
}

describe('fingerprintCodexTopBundle', () => {
  afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

  it('is stable across checkout/snapshot names and metadata order without returning paths', async () => {
    const f = await fixture();
    const baseline = await fingerprintCodexTopBundle(f);
    expect(baseline).toMatch(/^[a-f0-9]{64}$/);
    const other = await fixture();
    const sourceRoot = join(other.repoRoot, 'apps/cli/.snapshot-second');
    await cp(other.sourceRoot, sourceRoot, { recursive: true });
    const metafilePath = join(sourceRoot, 'metafile.json');
    const meta = JSON.parse(await readFile(metafilePath, 'utf8'));
    meta.inputs = { [join(other.repoRoot, 'node_modules/dependency/dist/index.js')]: { bytes: 20 }, [join(sourceRoot, 'src/index.ts')]: { bytes: 24 } };
    await file(metafilePath, JSON.stringify(meta));
    expect(await fingerprintCodexTopBundle({ ...other, sourceRoot, metafilePath })).toBe(baseline);
  });

  it.each([
    'src/index.ts', 'dependency', 'owner-package', 'inner-package', 'root-package',
    'snapshot-tsconfig', 'cli-tsconfig', 'lockfile', 'script', 'bun-version', 'bun-revision', 'bun-sha256', 'bun-bytes', 'profile', 'target', 'release',
  ])('changes when the actual %s input changes', async (kind) => {
    const f = await fixture();
    const baseline = await fingerprintCodexTopBundle(f);
    const paths: Record<string, string> = {
      'src/index.ts': join(f.sourceRoot, 'src/index.ts'),
      dependency: join(f.repoRoot, 'node_modules/dependency/dist/index.js'),
      'owner-package': join(f.repoRoot, 'node_modules/dependency/package.json'),
      'inner-package': join(f.repoRoot, 'node_modules/dependency/dist/package.json'),
      'root-package': join(f.repoRoot, 'package.json'),
      'snapshot-tsconfig': join(f.sourceRoot, 'tsconfig.json'),
      'cli-tsconfig': join(f.repoRoot, 'apps/cli/tsconfig.json'),
      lockfile: join(f.repoRoot, 'yarn.lock'), script: f.bundleScriptPath,
    };
    if (paths[kind]) await file(paths[kind], `${await readFile(paths[kind], 'utf8')}\nchanged`);
    else if (kind.startsWith('bun-')) {
      const metadata = JSON.parse(await readFile(f.metafilePath, 'utf8'));
      if (kind === 'bun-sha256') metadata.codexTopBuildRuntime.sha256 = 'b'.repeat(64);
      else if (kind === 'bun-bytes') metadata.codexTopBuildRuntime.bytes++;
      else metadata.codexTopBuildRuntime[kind === 'bun-version' ? 'version' : 'revision'] += '-changed';
      await file(f.metafilePath, JSON.stringify(metadata));
    } else if (kind === 'profile') f.profile.revision++;
    else if (kind === 'target') f.target = { ...target, arch: 'x64' };
    else f.releaseVersion = '91';
    expect(await fingerprintCodexTopBundle(f)).not.toBe(baseline);
  });

  it('ignores unrelated unconsumed source files rather than scanning the whole repository', async () => {
    const f = await fixture();
    const baseline = await fingerprintCodexTopBundle(f);
    await file(join(f.repoRoot, 'unrelated/private.txt'), 'not a bundle input');
    expect(await fingerprintCodexTopBundle(f)).toBe(baseline);
  });

  it.each(['missing', 'absolute', 'relative', 'symlink', 'package-symlink', 'metafile-symlink', 'runtime', 'runtime-sha256', 'runtime-bytes'])('fails closed for %s evidence', async (kind) => {
    const f = await fixture();
    if (kind === 'missing') await rm(join(f.sourceRoot, 'src/index.ts'));
    else if (kind.startsWith('runtime')) {
      const metadata = JSON.parse(await readFile(f.metafilePath, 'utf8'));
      if (kind === 'runtime') delete metadata.codexTopBuildRuntime;
      else if (kind === 'runtime-sha256') delete metadata.codexTopBuildRuntime.sha256;
      else metadata.codexTopBuildRuntime.bytes = -1;
      await file(f.metafilePath, JSON.stringify(metadata));
    } else {
      const outside = await mkdtemp(join(tmpdir(), 'codextop-fingerprint-outside-'));
      temporary.push(outside);
      await file(join(outside, 'data'), kind === 'metafile-symlink' ? await readFile(f.metafilePath, 'utf8') : 'outside');
      if (kind === 'symlink' || kind === 'package-symlink' || kind === 'metafile-symlink') {
        const path = kind === 'metafile-symlink' ? f.metafilePath : kind === 'symlink' ? join(f.sourceRoot, 'src/index.ts') : join(f.repoRoot, 'node_modules/dependency/package.json');
        await rm(path); await symlink(join(outside, 'data'), path);
      } else {
        const metadata = JSON.parse(await readFile(f.metafilePath, 'utf8'));
        metadata.inputs[kind === 'absolute' ? join(outside, 'data') : relative(f.repoRoot, join(outside, 'data'))] = {};
        await file(f.metafilePath, JSON.stringify(metadata));
      }
    }
    await expect(fingerprintCodexTopBundle(f)).rejects.toThrow();
  });
});
