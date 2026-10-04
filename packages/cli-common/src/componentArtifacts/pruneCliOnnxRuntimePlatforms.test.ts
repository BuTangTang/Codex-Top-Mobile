import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { pruneCliOnnxRuntimePlatforms } from './pruneCliOnnxRuntimePlatforms.js';

const tempDirs: string[] = [];
const knownLoader = fileURLToPath(new URL('./__fixtures__/onnxruntime-node-1.21.0-binding.cjs', import.meta.url));

/** 写入合成文件；原始 loader 夹具只作格式识别，不执行 native 或 JS 依赖。 */
async function write(path: string, bytes: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/** 每例建立独立 payload，三个平台的两种架构均有独特内容和动态库。 */
async function fixture(): Promise<{ payloadDir: string; packageDir: string; binaries: string }> {
  const payloadDir = await mkdtemp(join(tmpdir(), 'prune-onnx-platforms-'));
  tempDirs.push(payloadDir);
  const packageDir = join(payloadDir, 'node_modules/@huggingface/transformers/node_modules/onnxruntime-node');
  await write(join(packageDir, 'package.json'), JSON.stringify({ name: 'onnxruntime-node', version: '1.21.0', main: 'dist/index.js' }));
  await write(join(packageDir, 'dist/binding.js'), await readFile(knownLoader));
  await write(join(packageDir, 'LICENSE'), 'fixture-license');
  const binaries = join(packageDir, 'bin/napi-v3');
  for (const os of ['darwin', 'linux', 'win32']) {
    for (const arch of ['arm64', 'x64']) {
      await write(join(binaries, os, arch, 'onnxruntime_binding.node'), `native-${os}-${arch}`);
      await write(join(binaries, os, arch, 'runtime-library'), `library-${os}-${arch}`);
    }
  }
  await write(join(payloadDir, 'node_modules/unrelated/bin/napi-v3/linux/x64/keep'), 'unrelated-same-layout');
  return { payloadDir, packageDir, binaries };
}

/** 真实文件树哈希用于识别所有保留文件的非预期改动；相对键统一使用 /，不随宿主系统变化。 */
async function hashes(root: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const name = posix.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(root, name));
    else result[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
  }
  return result;
}

describe('pruneCliOnnxRuntimePlatforms', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it.each([['darwin', 'darwin'], ['linux', 'linux'], ['windows', 'win32']])(
    'keeps both architectures and every library for %s only', async (targetOs, kept) => {
      const { payloadDir, packageDir, binaries } = await fixture();
      const before = await hashes(packageDir);
      await pruneCliOnnxRuntimePlatforms({ payloadDir, targetOs });
      expect(await readdir(binaries)).toEqual([kept]);
      expect((await readdir(join(binaries, kept))).sort()).toEqual(['arm64', 'x64']);
      const expected = Object.fromEntries(Object.entries(before).filter(([path]) =>
        !path.startsWith('bin/napi-v3/') || path.startsWith(`bin/napi-v3/${kept}/`)));
      expect(await hashes(packageDir)).toEqual(expected);
      expect(await readFile(join(payloadDir, 'node_modules/unrelated/bin/napi-v3/linux/x64/keep'), 'utf8')).toBe('unrelated-same-layout');
    });

  it.each(['version', 'name', 'main', 'loader', 'malformed-json', 'unknown-platform', 'unknown-architecture', 'missing-binding', 'missing-target', 'unsupported-target'])(
    'preserves all bytes for unrecognized %s', async (kind) => {
      const { payloadDir, packageDir, binaries } = await fixture();
      if (['version', 'name', 'main'].includes(kind)) {
        const metadata = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
        metadata[kind] = 'unrecognized';
        await write(join(packageDir, 'package.json'), JSON.stringify(metadata));
      } else if (kind === 'loader') await write(join(packageDir, 'dist/binding.js'), 'different loader');
      else if (kind === 'malformed-json') await write(join(packageDir, 'package.json'), '{');
      else if (kind === 'unknown-platform') await mkdir(join(binaries, 'freebsd'));
      else if (kind === 'unknown-architecture') await mkdir(join(binaries, 'linux', 'armv7'));
      else if (kind === 'missing-binding') await rm(join(binaries, 'linux/arm64/onnxruntime_binding.node'));
      else if (kind === 'missing-target') await rm(join(binaries, 'darwin'), { recursive: true });
      const before = await hashes(payloadDir);
      await pruneCliOnnxRuntimePlatforms({ payloadDir, targetOs: kind === 'unsupported-target' ? 'freebsd' : 'darwin' });
      expect(await hashes(payloadDir)).toEqual(before);
    });

  it('does nothing when the known dependency is absent', async () => {
    const { payloadDir, packageDir } = await fixture();
    await rm(packageDir, { recursive: true });
    const before = await hashes(payloadDir);
    await pruneCliOnnxRuntimePlatforms({ payloadDir, targetOs: 'darwin' });
    expect(await hashes(payloadDir)).toEqual(before);
  });

  it.each(['package', 'loader', 'platform', 'native-file'])(
    'rejects a %s symlink before removing any platform or outside bytes', async (kind) => {
      const { payloadDir, packageDir, binaries } = await fixture();
      const outside = await mkdtemp(join(tmpdir(), 'onnx-outside-'));
      tempDirs.push(outside);
      await write(join(outside, 'keep'), 'outside-bytes');
      if (kind === 'package') {
        await rm(packageDir, { recursive: true });
        await symlink(outside, packageDir, 'dir');
      } else if (kind === 'loader') {
        await rm(join(packageDir, 'dist/binding.js'));
        await symlink(join(outside, 'keep'), join(packageDir, 'dist/binding.js'));
      } else if (kind === 'platform') {
        await rm(join(binaries, 'win32'), { recursive: true });
        await symlink(outside, join(binaries, 'win32'), 'dir');
      } else {
        await symlink(join(outside, 'keep'), join(binaries, 'win32/x64/linked-library'));
      }
      await expect(pruneCliOnnxRuntimePlatforms({ payloadDir, targetOs: 'darwin' })).rejects.toThrow('refusing symbolic links');
      expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('outside-bytes');
      if (kind !== 'package') expect(existsSync(join(binaries, 'linux/arm64/onnxruntime_binding.node'))).toBe(true);
    });
});
