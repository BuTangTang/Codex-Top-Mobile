import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const ADDON_NAME = '@img/sharp-darwin-arm64';
const LIBVIPS_NAME = '@img/sharp-libvips-darwin-arm64';
// 只处理已实测的完整包布局；上游新增文件或升级版本时保留两份原包，另行验证。
const KNOWN_ENTRIES: Readonly<Record<string, 'directory' | 'file'>> = {
  '.': 'directory',
  'README.md': 'file',
  lib: 'directory',
  'lib/glib-2.0': 'directory',
  'lib/glib-2.0/include': 'directory',
  'lib/glib-2.0/include/glibconfig.h': 'file',
  'lib/index.js': 'file',
  'lib/libvips-cpp.8.17.3.dylib': 'file',
  node_modules: 'directory',
  'package.json': 'file',
  'versions.json': 'file',
};

type PackageEntry = Readonly<{
  path: string;
  kind: 'directory' | 'file';
  mode: number;
  uid: number;
  gid: number;
  bytes?: number;
  sha256?: string;
}>;

/** 元数据仅接受普通对象，避免把数组或空值当作已识别的包身份。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 沿 payload 内相对路径逐层核对真实目录，拒绝父级或包根链接。 */
async function directoryAt(root: string, segments: readonly string[]): Promise<string | null> {
  let path = root;
  for (const segment of ['', ...segments]) {
    if (segment) path = join(path, segment);
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return null;
  }
  return path;
}

/** 读取已知目录中的普通元数据文件；任何链接或非对象 JSON 都是未知布局。 */
async function metadataAt(directory: string, name = 'package.json'): Promise<Record<string, unknown> | null> {
  const path = join(directory, name);
  if (!(await lstat(path)).isFile()) return null;
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  return isRecord(value) ? value : null;
}

/** 平台数组必须只有已实测的一个目标，不能把多架构包误当成当前固定布局。 */
function isSingleValue(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === expected;
}

/** 验证模块导出映射仍是实测的相对入口，不把新解析规则套入旧去重证据。 */
function hasExports(metadata: Record<string, unknown>, expected: Readonly<Record<string, string>>): boolean {
  const exports = metadata.exports;
  return isRecord(exports)
    && Object.keys(exports).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => exports[key] === value);
}

/** 流式计算大动态库哈希，避免为比较两份库同时持有整块文件缓冲区。 */
async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** 完整比较已知包的条目、权限、所有者与字节；既有链接或特殊文件一律保留原布局。 */
async function packageEntries(directory: string, name = '.'): Promise<PackageEntry[] | null> {
  const path = name === '.' ? directory : join(directory, name);
  const entry = await lstat(path);
  const kind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : null;
  if (!kind || KNOWN_ENTRIES[name] !== kind) return null;
  const common = { path: name, kind, mode: entry.mode & 0o7777, uid: entry.uid, gid: entry.gid } satisfies PackageEntry;
  if (kind === 'file') return [{ ...common, bytes: entry.size, sha256: await fileHash(path) }];
  const result: PackageEntry[] = [common];
  for (const child of (await readdir(path)).sort()) {
    const entries = await packageEntries(directory, name === '.' ? child : `${name}/${child}`);
    if (!entries) return null;
    result.push(...entries);
  }
  return result;
}

/** 预检只读且失败保守跳过；调用方只传入构建器独占的完整候选 payload。 */
async function inspectPackages(payloadDir: string) {
  try {
    const sharp = await directoryAt(resolve(payloadDir), ['node_modules', 'sharp']);
    if (!sharp) return null;
    const addon = await directoryAt(sharp, ['node_modules', '@img', 'sharp-darwin-arm64']);
    const retained = await directoryAt(sharp, ['node_modules', '@img', 'sharp-libvips-darwin-arm64']);
    if (!addon || !retained) return null;
    const nested = await directoryAt(addon, ['node_modules', '@img', 'sharp-libvips-darwin-arm64']);
    if (!nested) return null;
    const sharpInfo = await metadataAt(sharp);
    const addonInfo = await metadataAt(addon);
    const libvipsInfo = await metadataAt(retained);
    const versions = await metadataAt(retained, 'versions.json');
    if (!sharpInfo || sharpInfo.name !== 'sharp' || sharpInfo.version !== '0.34.5'
      || sharpInfo.type !== 'commonjs' || sharpInfo.main !== 'lib/index.js'
      || !isRecord(sharpInfo.optionalDependencies)
      || sharpInfo.optionalDependencies[ADDON_NAME] !== '0.34.5'
      || sharpInfo.optionalDependencies[LIBVIPS_NAME] !== '1.2.4') return null;
    if (!addonInfo || addonInfo.name !== ADDON_NAME || addonInfo.version !== '0.34.5'
      || addonInfo.type !== 'commonjs' || !isSingleValue(addonInfo.os, 'darwin') || !isSingleValue(addonInfo.cpu, 'arm64')
      || !isRecord(addonInfo.optionalDependencies) || addonInfo.optionalDependencies[LIBVIPS_NAME] !== '1.2.4'
      || !hasExports(addonInfo, { './sharp.node': './lib/sharp-darwin-arm64.node', './package': './package.json' })) return null;
    if (!libvipsInfo || libvipsInfo.name !== LIBVIPS_NAME || libvipsInfo.version !== '1.2.4'
      || libvipsInfo.type !== 'commonjs' || !isSingleValue(libvipsInfo.os, 'darwin') || !isSingleValue(libvipsInfo.cpu, 'arm64')
      || !hasExports(libvipsInfo, { './lib': './lib/index.js', './package': './package.json', './versions': './versions.json' })
      || versions?.vips !== '8.17.3') return null;
    const addonLib = await directoryAt(addon, ['lib']);
    if (!addonLib || !(await lstat(join(addonLib, 'sharp-darwin-arm64.node'))).isFile()) return null;
    const retainedEntries = await packageEntries(retained);
    const nestedEntries = await packageEntries(nested);
    if (!retainedEntries || retainedEntries.length !== Object.keys(KNOWN_ENTRIES).length
      || JSON.stringify(retainedEntries) !== JSON.stringify(nestedEntries)) return null;
    return { retained, nested, retainedEntries };
  } catch {
    // 元数据损坏、缺文件或不可读取均不授权删除；预检没有任何写操作。
    return null;
  }
}

/**
 * 只对已验证 darwin-arm64 的同一 Sharp 容器去掉完整相同的 libvips 副本。
 * 原 CLI 能力和源码依赖保持；须在独占候选 payload 复制完成、manifest/签名前调用。
 * 链接或回读失败时恢复原目录并抛出错误，禁止把不完整候选继续交给签名。
 */
export async function deduplicateCliSharpLibvipsPackage(params: Readonly<{
  payloadDir: string;
  targetOs: string;
  targetArch: string;
}>): Promise<void> {
  if (params.targetOs !== 'darwin' || params.targetArch !== 'arm64') return;
  const inspected = await inspectPackages(params.payloadDir);
  if (!inspected) return;
  const { retained, nested, retainedEntries } = inspected;
  const link = relative(dirname(nested), retained);
  // 固定相对目标留在同一 Sharp 容器，绝不创建绝对链接或链接到工作区依赖。
  if (isAbsolute(link) || link.split(sep).join('/') !== '../../../sharp-libvips-darwin-arm64') return;
  const backupDirectory = await mkdtemp(join(dirname(nested), '.sharp-libvips-dedupe-'));
  const backup = join(backupDirectory, 'package');
  let moved = false;
  let linked = false;
  try {
    await rename(nested, backup);
    moved = true;
    await symlink(link, nested, 'dir');
    linked = true;
    if (await realpath(nested) !== await realpath(retained)
      || JSON.stringify(await packageEntries(retained)) !== JSON.stringify(retainedEntries)) {
      throw new Error('[component-artifacts] Sharp libvips link verification failed');
    }
  } catch (error) {
    if (linked) await unlink(nested);
    if (moved) await rename(backup, nested);
    await rm(backupDirectory, { recursive: true, force: false });
    throw error;
  }
  // 核对成功才移除自有备份；所有许可、元数据和动态库仍由 retained 完整保留。
  await rm(backupDirectory, { recursive: true, force: false });
}
