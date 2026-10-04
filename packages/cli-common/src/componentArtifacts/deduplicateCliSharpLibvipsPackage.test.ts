import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { deduplicateCliSharpLibvipsPackage } from './deduplicateCliSharpLibvipsPackage.js';

const failure = vi.hoisted(() => ({ link: false, afterLink: false, resolution: false }));
// 只在真实文件系统边界注入失败，目录遍历、身份比较、链接和回滚逻辑均运行生产实现。
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    symlink: async (...args: Parameters<typeof actual.symlink>) => {
      if (failure.link) throw Object.assign(new Error('synthetic link failure'), { code: 'EACCES' });
      await actual.symlink(...args);
      if (failure.afterLink) failure.resolution = true;
    },
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      if (failure.resolution) {
        failure.resolution = false;
        throw Object.assign(new Error('synthetic resolution failure'), { code: 'EIO' });
      }
      return actual.realpath(...args);
    },
  };
});

const tempDirs: string[] = [];
const addonName = '@img/sharp-darwin-arm64';
const libvipsName = '@img/sharp-libvips-darwin-arm64';
const target = { targetOs: 'darwin', targetArch: 'arm64' };

/** 合成内容只写入每例独立目录，不复制机器上的真实依赖或账号。 */
async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** 建立已核验的 Sharp 0.34.5/libvips 1.2.4 布局，两个完整包内容与权限相同。 */
async function fixture() {
  const payloadDir = await mkdtemp(join(tmpdir(), 'sharp-libvips-dedupe-'));
  tempDirs.push(payloadDir);
  const sharp = join(payloadDir, 'node_modules/sharp');
  const addon = join(sharp, 'node_modules', addonName);
  const retained = join(sharp, 'node_modules', libvipsName);
  const nested = join(addon, 'node_modules', libvipsName);
  await write(join(sharp, 'package.json'), JSON.stringify({
    name: 'sharp', version: '0.34.5', main: 'lib/index.js', type: 'commonjs',
    optionalDependencies: { [addonName]: '0.34.5', [libvipsName]: '1.2.4' },
  }));
  await write(join(sharp, 'lib/index.js'), 'module.exports = {};');
  await write(join(addon, 'package.json'), JSON.stringify({
    name: addonName, version: '0.34.5', type: 'commonjs', os: ['darwin'], cpu: ['arm64'],
    optionalDependencies: { [libvipsName]: '1.2.4' },
    exports: { './sharp.node': './lib/sharp-darwin-arm64.node', './package': './package.json' },
  }));
  await write(join(addon, 'lib/sharp-darwin-arm64.node'), 'synthetic-addon');
  await write(join(retained, 'package.json'), JSON.stringify({
    name: libvipsName, version: '1.2.4', type: 'commonjs', os: ['darwin'], cpu: ['arm64'],
    exports: { './lib': './lib/index.js', './package': './package.json', './versions': './versions.json' },
  }));
  await write(join(retained, 'README.md'), 'synthetic license notices');
  await write(join(retained, 'versions.json'), JSON.stringify({ vips: '8.17.3' }));
  await write(join(retained, 'lib/index.js'), 'module.exports = __dirname;');
  await write(join(retained, 'lib/glib-2.0/include/glibconfig.h'), 'synthetic-glib');
  await write(join(retained, 'lib/libvips-cpp.8.17.3.dylib'), 'synthetic-native');
  await mkdir(join(retained, 'node_modules'));
  await mkdir(dirname(nested), { recursive: true });
  await cp(retained, nested, { recursive: true });
  await write(join(payloadDir, 'unrelated', libvipsName, 'keep'), 'outside Sharp container');
  return { payloadDir, sharp, addon, retained, nested };
}

/** 不跟随链接记录整棵树，证明拒绝和回滚没有改动其它文件或权限。 */
async function snapshot(root: string, name = '.'): Promise<Record<string, unknown>> {
  const path = name === '.' ? root : join(root, name);
  const entry = await lstat(path);
  const common = { mode: entry.mode & 0o7777, uid: entry.uid, gid: entry.gid };
  if (entry.isSymbolicLink()) return { [name]: { ...common, type: 'link', target: await readlink(path) } };
  if (entry.isFile()) return { [name]: { ...common, type: 'file', hash: createHash('sha256').update(await readFile(path)).digest('hex') } };
  const result: Record<string, unknown> = { [name]: { ...common, type: 'directory' } };
  for (const child of (await readdir(path)).sort()) Object.assign(result, await snapshot(root, name === '.' ? child : posix.join(name, child)));
  return result;
}

describe('deduplicateCliSharpLibvipsPackage', () => {
  afterEach(async () => {
    failure.link = failure.afterLink = failure.resolution = false;
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('keeps one complete package and resolves the relative link after relocation and repeat invocation', async () => {
    const { payloadDir, sharp, retained, nested } = await fixture();
    const before = await snapshot(payloadDir);
    const ownerBefore = await snapshot(retained);
    await deduplicateCliSharpLibvipsPackage({ payloadDir, ...target });
    expect((await lstat(nested)).isSymbolicLink()).toBe(true);
    expect(await readlink(nested)).toBe('../../../sharp-libvips-darwin-arm64');
    expect(await realpath(nested)).toBe(await realpath(retained));
    expect(await snapshot(retained)).toEqual(ownerBefore);
    const nestedKey = relative(payloadDir, nested).split('\\').join('/');
    const unchanged = (tree: Record<string, unknown>) => Object.fromEntries(Object.entries(tree).filter(([key]) => key !== nestedKey && !key.startsWith(nestedKey + '/')));
    const after = await snapshot(payloadDir);
    expect(unchanged(after)).toEqual(unchanged(before));
    await deduplicateCliSharpLibvipsPackage({ payloadDir, ...target });
    expect(await snapshot(payloadDir)).toEqual(after);
    const relocated = join(payloadDir, 'relocated-sharp');
    await rename(sharp, relocated);
    const relocatedNested = join(relocated, relative(sharp, nested));
    expect(await realpath(relocatedNested)).toBe(await realpath(join(relocated, relative(sharp, retained))));
  });

  it.each(['content', 'missing-file', 'extra-file', 'entry-type', 'name', 'version', 'exports', 'platform', 'architecture', 'malformed-json', 'addon-dependency', 'sharp-version', 'unknown-vips', 'unknown-layout'])(
    'leaves the full payload untouched for %s differences or unknown metadata', async (kind) => {
      const { payloadDir, sharp, addon, retained, nested } = await fixture();
      if (kind === 'content') await write(join(nested, 'README.md'), 'different license');
      else if (kind === 'missing-file') await rm(join(nested, 'README.md'));
      else if (kind === 'extra-file') await write(join(nested, 'extra'), 'extra');
      else if (kind === 'entry-type') { await rm(join(nested, 'README.md')); await mkdir(join(nested, 'README.md')); }
      else if (kind === 'malformed-json') {
        for (const path of [retained, nested]) await write(join(path, 'package.json'), '{');
      }
      else if (kind === 'unknown-layout') {
        for (const path of [retained, nested]) await write(join(path, 'new-layout'), 'identical extra entry');
      } else if (kind === 'unknown-vips') {
        for (const path of [retained, nested]) await write(join(path, 'versions.json'), JSON.stringify({ vips: '9.0.0' }));
      } else {
        const path = join(kind === 'sharp-version' ? sharp : kind === 'addon-dependency' ? addon : retained, 'package.json');
        const metadata = JSON.parse(await readFile(path, 'utf8'));
        if (kind === 'addon-dependency') metadata.optionalDependencies[libvipsName] = '^1.2.4';
        else if (kind === 'sharp-version' || kind === 'version') metadata.version = '99.0.0';
        else if (kind === 'exports') metadata.exports['./lib'] = './other.js';
        else if (kind === 'platform') metadata.os = ['linux'];
        else if (kind === 'architecture') metadata.cpu = ['x64'];
        else metadata.name = 'unknown';
        await write(path, JSON.stringify(metadata));
        // 两份包同时变为相同的未知身份，避免仅由内容不同掩盖身份守卫缺失。
        if (kind !== 'sharp-version' && kind !== 'addon-dependency') await write(join(nested, 'package.json'), JSON.stringify(metadata));
      }
      const before = await snapshot(payloadDir);
      await deduplicateCliSharpLibvipsPackage({ payloadDir, ...target });
      expect(await snapshot(payloadDir)).toEqual(before);
    });

  it.skipIf(process.platform === 'win32')('preserves differing permissions even when every file has identical bytes', async () => {
    const { payloadDir, nested } = await fixture();
    await chmod(join(nested, 'lib/libvips-cpp.8.17.3.dylib'), 0o600);
    const before = await snapshot(payloadDir);
    await deduplicateCliSharpLibvipsPackage({ payloadDir, ...target });
    expect(await snapshot(payloadDir)).toEqual(before);
  });

  it.each([{ targetOs: 'darwin', targetArch: 'x64' }, { targetOs: 'linux', targetArch: 'arm64' }, { targetOs: 'windows', targetArch: 'arm64' }])(
    'does not change unsupported target $targetOs/$targetArch', async (otherTarget) => {
      const { payloadDir } = await fixture();
      const before = await snapshot(payloadDir);
      await deduplicateCliSharpLibvipsPackage({ payloadDir, ...otherTarget });
      expect(await snapshot(payloadDir)).toEqual(before);
    });

  it('does nothing if Sharp is absent', async () => {
    const { payloadDir, sharp } = await fixture();
    await rm(sharp, { recursive: true });
    const before = await snapshot(payloadDir);
    await deduplicateCliSharpLibvipsPackage({ payloadDir, ...target });
    expect(await snapshot(payloadDir)).toEqual(before);
  });

  it.each(['payload-root', 'parent', 'package-root', 'metadata', 'internal', 'external', 'dangling', 'cycle'])(
    'skips %s symlinks without following or modifying outside data', async (kind) => {
      const { payloadDir, sharp, retained, nested } = await fixture();
      const outside = await mkdtemp(join(tmpdir(), 'sharp-dedupe-outside-'));
      tempDirs.push(outside);
      await write(join(outside, 'keep'), 'outside-bytes');
      let input = payloadDir;
      if (kind === 'payload-root') {
        input = join(outside, 'payload-link');
        await symlink(payloadDir, input, 'dir');
      } else if (kind === 'parent') {
        const directory = join(sharp, 'node_modules');
        const moved = join(outside, 'modules');
        await rename(directory, moved);
        await symlink(moved, directory, 'dir');
      } else if (kind === 'package-root') {
        await rm(nested, { recursive: true });
        await symlink(retained, nested, 'dir');
      } else if (kind === 'metadata') {
        const metadata = join(sharp, 'package.json');
        await rename(metadata, join(outside, 'package.json'));
        await symlink(join(outside, 'package.json'), metadata);
      } else {
        const destination = kind === 'internal' ? 'lib/index.js' : kind === 'external' ? join(outside, 'keep') : kind === 'cycle' ? 'README.md' : 'missing';
        for (const path of [retained, nested]) {
          await rm(join(path, 'README.md'));
          await symlink(destination, join(path, 'README.md'));
        }
      }
      const before = await snapshot(payloadDir);
      const outsideBefore = await snapshot(outside);
      await deduplicateCliSharpLibvipsPackage({ payloadDir: input, ...target });
      expect(await snapshot(payloadDir)).toEqual(before);
      expect(await snapshot(outside)).toEqual(outsideBefore);
    });

  it.each(['link', 'afterLink'] as const)('rolls back the complete original tree when %s fails', async (point) => {
    const { payloadDir } = await fixture();
    const before = await snapshot(payloadDir);
    failure[point] = true;
    await expect(deduplicateCliSharpLibvipsPackage({ payloadDir, ...target })).rejects.toThrow('synthetic');
    expect(await snapshot(payloadDir)).toEqual(before);
  });
});
