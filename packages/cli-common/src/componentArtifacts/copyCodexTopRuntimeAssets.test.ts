import { createRequire } from 'node:module';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CODEX_TOP_ARTIFACT_PROFILE as profile } from './codexTopArtifactProfile.js';
import { copyCodexTopRuntimeAssets } from './copyCodexTopRuntimeAssets.js';

const temporary: string[] = [];

/** 合成文件始终写入独立临时仓库，不依赖开发机已安装包。 */
async function write(file: string, value: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, value);
}

/** 保留真实包名、版本和布局；JS 使用可实际 require 的独立小闭包。 */
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'codextop-runtime-assets-'));
  temporary.push(base);
  const repoRoot = join(base, 'repo');
  const payloadDir = join(base, 'payload');
  const metafilePath = join(base, 'metafile.json');
  await mkdir(payloadDir);
  await write(join(payloadDir, 'happier'), 'immutable-bundle');
  await write(join(repoRoot, 'apps/cli/package.json'), JSON.stringify({ name: '@happier-dev/cli', version: '0.2.13', license: 'MIT' }));
  for (const pkg of [...profile.nativePackages, ...profile.runtimePackages]) {
    const root = join(repoRoot, 'node_modules', pkg.name);
    for (const entry of pkg.entries) {
      if (entry === 'package.json') continue;
      const isDirectory = ['lib', 'classes', 'functions', 'internal', 'ranges', 'prebuilds/darwin-arm64'].includes(entry);
      await write(join(root, entry, ...(isDirectory ? ['index.js'] : [])), 'module.exports = "fixture";');
    }
    await write(join(root, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, license: 'MIT', main: pkg.name === '@img/colour' ? 'index.cjs' : 'lib/index.js' }));
  }
  const sharpDir = join(repoRoot, 'node_modules/sharp');
  await write(join(sharpDir, 'package.json'), JSON.stringify({ name: 'sharp', version: '0.34.5', main: 'lib/index.js', license: 'Apache-2.0', dependencies: Object.fromEntries(profile.runtimePackages.map((pkg) => [pkg.name, pkg.version])) }));
  await write(join(sharpDir, 'lib/index.js'), 'module.exports = require("@img/colour");');
  await write(join(repoRoot, 'node_modules/@img/colour/index.cjs'), 'module.exports = require("./color.cjs");');
  await write(join(repoRoot, 'node_modules/@img/colour/color.cjs'), 'module.exports = "copied-colour";');
  await write(join(repoRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node'), 'native-pty');
  await write(join(repoRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 'spawn-helper');
  await chmod(join(repoRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755);
  await write(join(repoRoot, 'node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node'), 'native-sharp');
  await write(join(repoRoot, 'node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib'), 'native-libvips');
  for (const sidecar of profile.sidecars) {
    await write(join(repoRoot, 'apps/cli/scripts', sidecar), `sidecar-${sidecar}`);
    await chmod(join(repoRoot, 'apps/cli/scripts', sidecar), 0o755);
  }
  await write(join(repoRoot, 'node_modules/node-pty/prebuilds/linux-x64/pty.node'), 'not-for-product');
  await write(join(repoRoot, 'node_modules/sharp/node_modules/unrelated/blob'), 'not-a-runtime-dependency');
  await write(join(repoRoot, 'node_modules/retained/package.json'), JSON.stringify({ name: 'retained', version: '1.0.0', license: 'MIT' }));
  await write(join(repoRoot, 'node_modules/retained/index.js'), 'module.exports=1;');
  await write(join(repoRoot, 'node_modules/retained/LICENSE'), 'retained-license');
  await write(join(repoRoot, 'node_modules/retained/NOTICE'), 'retained-notice');
  await write(join(repoRoot, 'node_modules/eliminated/package.json'), JSON.stringify({ name: 'eliminated', version: '1.0.0', license: 'MIT' }));
  await write(join(repoRoot, 'node_modules/eliminated/index.js'), 'module.exports=2;');
  await write(metafilePath, JSON.stringify({ inputs: { 'node_modules/retained/index.js': {}, 'node_modules/eliminated/index.js': {} }, outputs: { 'index.mjs': { inputs: { 'node_modules/retained/index.js': { bytesInOutput: 12 }, 'node_modules/eliminated/index.js': { bytesInOutput: 0 } } } } }));
  return { repoRoot, payloadDir, metafilePath };
}

describe('copyCodexTopRuntimeAssets', () => {
  afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

  it('copies only the platform closure, preserves executability and supports actual JS requires', async () => {
    const f = await fixture();
    await copyCodexTopRuntimeAssets(f);
    expect(createRequire(join(f.payloadDir, 'entry.cjs'))('sharp')).toBe('copied-colour');
    expect(await readdir(join(f.payloadDir, 'node_modules/node-pty/prebuilds'))).toEqual(['darwin-arm64']);
    expect((await stat(join(f.payloadDir, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'))).mode & 0o111).toBe(0o111);
    for (const sidecar of profile.sidecars) expect(await readFile(join(f.payloadDir, 'scripts', sidecar), 'utf8')).toBe(`sidecar-${sidecar}`);
    await expect(stat(join(f.payloadDir, 'node_modules/sharp/node_modules'))).rejects.toThrow();
    expect(await readFile(join(f.payloadDir, 'happier'), 'utf8')).toBe('immutable-bundle');
  });

  it('makes only the copied PTY spawn helper executable when its installed source is 0644', async () => {
    const f = await fixture();
    const helper = 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper';
    const binary = 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node';
    const sidecar = 'scripts/node_pty_relay.cjs';
    await chmod(join(f.repoRoot, helper), 0o644);
    await chmod(join(f.repoRoot, binary), 0o640);
    await chmod(join(f.repoRoot, 'apps/cli', sidecar), 0o750);
    await copyCodexTopRuntimeAssets(f);
    expect((await stat(join(f.repoRoot, helper))).mode & 0o777).toBe(0o644);
    expect((await stat(join(f.payloadDir, helper))).mode & 0o777).toBe(0o755);
    expect((await stat(join(f.payloadDir, binary))).mode & 0o777).toBe(0o640);
    expect((await stat(join(f.payloadDir, sidecar))).mode & 0o777).toBe(0o750);
    expect(await readFile(join(f.payloadDir, helper))).toEqual(await readFile(join(f.repoRoot, helper)));
    expect(await readFile(join(f.payloadDir, binary))).toEqual(await readFile(join(f.repoRoot, binary)));
  });

  it('attributes retained modules only, keeps notices, and records missing CLI license text without inventing it', async () => {
    const f = await fixture();
    await copyCodexTopRuntimeAssets(f);
    const raw = await readFile(join(f.payloadDir, 'licenses/index.json'), 'utf8');
    const index = JSON.parse(raw);
    expect(index.cli).toMatchObject({ name: '@happier-dev/cli', license: 'MIT', licenseTextAvailable: false });
    const retained = index.packages.find((pkg: { name: string }) => pkg.name === 'retained');
    expect(retained).toMatchObject({ version: '1.0.0', licenseTextAvailable: true });
    expect(await Promise.all(retained.files.map((file: string) => readFile(join(f.payloadDir, file), 'utf8')))).toEqual(['retained-license', 'retained-notice']);
    expect(index.packages.some((pkg: { name: string }) => pkg.name === 'eliminated')).toBe(false);
    expect(raw).not.toContain(f.repoRoot);
    expect(raw).not.toContain(f.payloadDir);
  });

  it('retains attribution-only README with an explicit missing-text marker', async () => {
    const f = await fixture();
    await rm(join(f.repoRoot, 'node_modules/retained/LICENSE'));
    await rm(join(f.repoRoot, 'node_modules/retained/NOTICE'));
    await write(join(f.repoRoot, 'node_modules/retained/README.md'), 'License: MIT; see upstream.');
    await copyCodexTopRuntimeAssets(f);
    const index = JSON.parse(await readFile(join(f.payloadDir, 'licenses/index.json'), 'utf8'));
    const pkg = index.packages.find((item: { name: string }) => item.name === 'retained');
    expect(pkg.licenseTextAvailable).toBe(false);
    expect(await readFile(join(f.payloadDir, pkg.files[0]), 'utf8')).toBe('License: MIT; see upstream.');
  });

  it('resolves the Sharp-owned dependency before a different hoisted version', async () => {
    const f = await fixture();
    const hoisted = join(f.repoRoot, 'node_modules/@img/colour');
    const nested = join(f.repoRoot, 'node_modules/sharp/node_modules/@img/colour');
    await cp(hoisted, nested, { recursive: true });
    const metadata = JSON.parse(await readFile(join(hoisted, 'package.json'), 'utf8'));
    await write(join(hoisted, 'package.json'), JSON.stringify({ ...metadata, version: '9.0.0' }));
    await copyCodexTopRuntimeAssets(f);
    expect(createRequire(join(f.payloadDir, 'entry.cjs'))('sharp')).toBe('copied-colour');
    expect(JSON.parse(await readFile(join(f.payloadDir, 'node_modules/@img/colour/package.json'), 'utf8')).version).toBe('1.0.0');
  });

  it('does not silently overwrite different licenses for duplicate package name/version', async () => {
    const f = await fixture();
    const nested = 'node_modules/parent/node_modules/retained';
    await cp(join(f.repoRoot, 'node_modules/retained'), join(f.repoRoot, nested), { recursive: true });
    await write(join(f.repoRoot, nested, 'LICENSE'), 'different-license');
    const metadata = JSON.parse(await readFile(f.metafilePath, 'utf8'));
    metadata.inputs[`${nested}/index.js`] = {};
    metadata.outputs['index.mjs'].inputs[`${nested}/index.js`] = { bytesInOutput: 10 };
    await write(f.metafilePath, JSON.stringify(metadata));
    await expect(copyCodexTopRuntimeAssets(f)).rejects.toThrow('conflicting asset');
    expect(await readdir(f.payloadDir)).toEqual(['happier']);
  });

  it.each(['version', 'dependency', 'native-file', 'sidecar'])('fails before copying for an unsupported or missing %s', async (kind) => {
    const f = await fixture();
    if (kind === 'version' || kind === 'dependency') {
      const path = join(f.repoRoot, 'node_modules/@img/colour/package.json');
      const pkg = JSON.parse(await readFile(path, 'utf8'));
      if (kind === 'version') pkg.version = '2.0.0';
      else pkg.dependencies = { surprise: '*' };
      await write(path, JSON.stringify(pkg));
    } else if (kind === 'native-file') await rm(join(f.repoRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node'));
    else await rm(join(f.repoRoot, 'apps/cli/scripts/node_pty_relay.cjs'));
    await expect(copyCodexTopRuntimeAssets(f)).rejects.toThrow();
    expect(await readdir(f.payloadDir)).toEqual(['happier']);
  });

  it.each(['source', 'destination', 'metafile'])('rejects %s escapes without copying outside data', async (kind) => {
    const f = await fixture();
    const outside = join(dirname(f.repoRoot), 'outside');
    await write(join(outside, 'keep'), 'outside');
    if (kind === 'source') {
      const path = join(f.repoRoot, 'node_modules/sharp/lib');
      await rm(path, { recursive: true });
      await symlink(outside, path);
    } else if (kind === 'destination') await symlink(outside, join(f.payloadDir, 'node_modules'));
    else await write(f.metafilePath, JSON.stringify({ inputs: { [join(outside, 'keep')]: {} }, outputs: { 'index.mjs': { inputs: { [join(outside, 'keep')]: { bytesInOutput: 10 } } } } }));
    await expect(copyCodexTopRuntimeAssets(f)).rejects.toThrow();
    expect(await readdir(outside)).toEqual(['keep']);
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('outside');
  });
});
