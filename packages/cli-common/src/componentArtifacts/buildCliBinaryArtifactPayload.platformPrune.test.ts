import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import cliDistBuildManifest from '../../cliDistBuildManifest.cjs';
import { buildCliBinaryArtifactPayload } from './buildCliBinaryArtifactPayload.js';

const tempDirs: string[] = [];
const onnxSegments = ['node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-node'];
const fixtureLoader = fileURLToPath(new URL('./__fixtures__/onnxruntime-node-1.21.0-binding.cjs', import.meta.url));

/** 只在本例独立临时目录写入合成依赖和工具，不读取现有账号或运行构建命令。 */
async function writeFixture(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** 记录完整文件哈希，证明保留文件均未改字节；相对键统一使用 /，不随宿主系统变化。 */
async function fileHashes(root: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const name = posix.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(result, await fileHashes(root, name));
    else result[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
  }
  return result;
}

/** 建立真实 canonical 可消费的最小依赖树；外部编译和工具解包仅写合成产物。 */
async function createRepo(): Promise<{ repoRoot: string; payloadDir: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'cli-platform-prune-'));
  tempDirs.push(repoRoot);
  await writeFixture(join(repoRoot, 'package.json'), JSON.stringify({ name: 'fixture', private: true }));
  await writeFixture(join(repoRoot, 'yarn.lock'), '');
  await writeFixture(join(repoRoot, 'apps/cli/package.json'), JSON.stringify({
    name: '@happier-dev/cli', version: '0.0.0', bundledDependencies: [], dependencies: { sharp: '0.34.5' },
  }));
  await writeFixture(join(repoRoot, 'apps/cli/src/index.ts'), 'export {};');
  for (const name of ['childProcessOptions.cjs', 'claude_launcher_runtime.cjs', 'claude_local_launcher.cjs',
    'claude_remote_launcher.cjs', 'session_hook_forwarder.cjs', 'permission_hook_forwarder.cjs',
    'ripgrep_launcher.cjs', 'statusline_forwarder.cjs', 'terminal_launch_spec_runner.cjs',
    'node_pty_relay.cjs', 'runtime/placeholder.txt', 'shims/placeholder.txt']) {
    await writeFixture(join(repoRoot, 'apps/cli/scripts', name), 'fixture-sidecar');
  }
  await writeFixture(join(repoRoot, 'apps/cli/tools/archives/placeholder'), 'fixture-archive');
  await writeFixture(join(repoRoot, 'apps/cli/scripts/unpack-tools.cjs'), 'exports.unpackTools = () => {};');
  for (const name of ['@huggingface/transformers', 'node-pty', '@homebridge/node-pty-prebuilt-multiarch']) {
    await writeFixture(join(repoRoot, 'node_modules', name, 'package.json'), JSON.stringify({
      name, version: '0.0.0', main: 'index.js',
      dependencies: name === '@huggingface/transformers' ? { 'onnxruntime-node': '1.21.0' } : {},
    }));
    await writeFixture(join(repoRoot, 'node_modules', name, 'index.js'), 'module.exports = {};');
  }
  const onnxRoot = join(repoRoot, ...onnxSegments);
  await writeFixture(join(onnxRoot, 'package.json'), JSON.stringify({ name: 'onnxruntime-node', version: '1.21.0', main: 'dist/index.js' }));
  await writeFixture(join(onnxRoot, 'dist/binding.js'), await readFile(fixtureLoader));
  await writeFixture(join(onnxRoot, 'dist/index.js'), 'module.exports = require("./binding.js");');
  await writeFixture(join(onnxRoot, 'LICENSE'), 'fixture-license');
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const arch of ['arm64', 'x64']) {
      await writeFixture(join(onnxRoot, 'bin/napi-v3', platform, arch, 'onnxruntime_binding.node'), `fixture-binding-${platform}-${arch}`);
      await writeFixture(join(onnxRoot, 'bin/napi-v3', platform, arch, 'runtime-library'), `fixture-library-${platform}-${arch}`);
    }
  }
  const sharpRoot = join(repoRoot, 'node_modules/sharp');
  const addonName = '@img/sharp-darwin-arm64';
  const libvipsName = '@img/sharp-libvips-darwin-arm64';
  await writeFixture(join(sharpRoot, 'package.json'), JSON.stringify({
    name: 'sharp', version: '0.34.5', main: 'lib/index.js', type: 'commonjs',
    optionalDependencies: { [addonName]: '0.34.5', [libvipsName]: '1.2.4' },
  }));
  await writeFixture(join(sharpRoot, 'lib/index.js'), 'module.exports = {};');
  await writeFixture(join(sharpRoot, 'node_modules', addonName, 'package.json'), JSON.stringify({
    name: addonName, version: '0.34.5', type: 'commonjs', os: ['darwin'], cpu: ['arm64'],
    optionalDependencies: { [libvipsName]: '1.2.4' },
    exports: { './sharp.node': './lib/sharp-darwin-arm64.node', './package': './package.json' },
  }));
  await writeFixture(join(sharpRoot, 'node_modules', addonName, 'lib/sharp-darwin-arm64.node'), 'fixture-addon');
  const libvipsRoot = join(sharpRoot, 'node_modules', libvipsName);
  await writeFixture(join(libvipsRoot, 'package.json'), JSON.stringify({
    name: libvipsName, version: '1.2.4', type: 'commonjs', os: ['darwin'], cpu: ['arm64'],
    exports: { './lib': './lib/index.js', './package': './package.json', './versions': './versions.json' },
  }));
  await writeFixture(join(libvipsRoot, 'README.md'), 'fixture license notices');
  await writeFixture(join(libvipsRoot, 'versions.json'), JSON.stringify({ vips: '8.17.3' }));
  await writeFixture(join(libvipsRoot, 'lib/index.js'), 'module.exports = __dirname;');
  await writeFixture(join(libvipsRoot, 'lib/glib-2.0/include/glibconfig.h'), 'fixture-glib');
  await writeFixture(join(libvipsRoot, 'lib/libvips-cpp.8.17.3.dylib'), 'fixture-native-library');
  await mkdir(join(libvipsRoot, 'node_modules'));
  return { repoRoot, payloadDir: join(repoRoot, 'payload') };
}

describe('canonical CLI payload platform pruning and Sharp deduplication', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('removes only other operating systems after vendoring and preserves every retained byte', async () => {
    const { repoRoot, payloadDir } = await createRepo();
    const before = await fileHashes(join(repoRoot, ...onnxSegments));
    await buildCliBinaryArtifactPayload({
      repoRoot, payloadDir,
      target: { bunTarget: 'bun-darwin-arm64', os: 'darwin', arch: 'arm64', exeExt: '' },
      commandProbe: (command) => command === 'bun' || command === 'yarn',
      ensureWorkspacePackagesBuiltByName: async (_root, names) => ({ ok: true, built: [], skipped: names }),
      runCommand: async () => {
        const entrypoint = join(repoRoot, 'apps/cli/dist/index.mjs');
        await writeFixture(entrypoint, 'export const fixture = true;');
        cliDistBuildManifest.writeCliDistBuildManifest(entrypoint);
      },
      compileBinary: async ({ outfile }) => { await writeFixture(outfile, 'fixture-compiled-binary'); },
    });
    const installedRoot = join(payloadDir, ...onnxSegments);
    expect(existsSync(join(installedRoot, 'bin/napi-v3/linux'))).toBe(false);
    expect(existsSync(join(installedRoot, 'bin/napi-v3/win32'))).toBe(false);
    const expected = Object.fromEntries(Object.entries(before).filter(([path]) => !/^bin\/napi-v3\/(linux|win32)\//.test(path)));
    expect(await fileHashes(installedRoot)).toEqual(expected);
    expect(await fileHashes(join(repoRoot, ...onnxSegments))).toEqual(before);
    expect(existsSync(join(payloadDir, 'happier'))).toBe(true);
    expect(existsSync(join(payloadDir, 'package-dist/.build-manifest.json'))).toBe(true);
  });

  it('deduplicates identical libvips packages inside the vendored Sharp container without changing source files', async () => {
    const { repoRoot, payloadDir } = await createRepo();
    const source = join(repoRoot, 'node_modules/sharp');
    const before = await fileHashes(source);
    await buildCliBinaryArtifactPayload({
      repoRoot, payloadDir,
      target: { bunTarget: 'bun-darwin-arm64', os: 'darwin', arch: 'arm64', exeExt: '' },
      commandProbe: (command) => command === 'bun' || command === 'yarn',
      ensureWorkspacePackagesBuiltByName: async (_root, names) => ({ ok: true, built: [], skipped: names }),
      runCommand: async () => {
        const entrypoint = join(repoRoot, 'apps/cli/dist/index.mjs');
        await writeFixture(entrypoint, 'export const fixture = true;');
        cliDistBuildManifest.writeCliDistBuildManifest(entrypoint);
      },
      compileBinary: async ({ outfile }) => { await writeFixture(outfile, 'fixture-compiled-binary'); },
    });
    const retained = join(payloadDir, 'node_modules/sharp/node_modules/@img/sharp-libvips-darwin-arm64');
    const nested = join(payloadDir, 'node_modules/sharp/node_modules/@img/sharp-darwin-arm64/node_modules/@img/sharp-libvips-darwin-arm64');
    expect((await lstat(nested)).isSymbolicLink()).toBe(true);
    expect(await readlink(nested)).toBe('../../../sharp-libvips-darwin-arm64');
    expect(await realpath(nested)).toBe(await realpath(retained));
    expect(await fileHashes(retained)).toEqual(await fileHashes(join(source, 'node_modules/@img/sharp-libvips-darwin-arm64')));
    expect(await fileHashes(source)).toEqual(before);
  });
});
