import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { BinaryTarget } from './targets.js';

/** 比较目录边界，不能用字符串前缀允许同名前缀目录越界。 */
function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** 构建策略采用稳定键序列；数组顺序仍是有效构建输入。 */
function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('[codex-top-fingerprint] build policy must contain JSON values');
}

/** 根据同次 Bun 构建的实际输入产生指纹，不用于复用旧 bundle。 */
export async function fingerprintCodexTopBundle(params: Readonly<{
  repoRoot: string;
  sourceRoot: string;
  metafilePath: string;
  profile: unknown;
  target: BinaryTarget;
  releaseVersion: string;
  bundleScriptPath: string;
}>): Promise<string> {
  const repositoryAlias = resolve(params.repoRoot);
  const repoRoot = await realpath(params.repoRoot);
  const sourceRoot = await realpath(params.sourceRoot);
  if (!within(repoRoot, sourceRoot) || sourceRoot === repoRoot) throw new Error('[codex-top-fingerprint] source snapshot escapes repository');
  const metadataPath = await realpath(resolveInput(params.metafilePath));
  if (!within(repoRoot, metadataPath)) throw new Error('[codex-top-fingerprint] metafile symlink escapes repository');
  const metafile = JSON.parse(await readFile(metadataPath, 'utf8')) as {
    inputs?: Record<string, unknown>;
    codexTopBuildRuntime?: { version?: unknown; revision?: unknown; sha256?: unknown; bytes?: unknown };
  };
  const runtime = metafile.codexTopBuildRuntime;
  if (!runtime || typeof runtime.version !== 'string' || !runtime.version.trim()
    || typeof runtime.revision !== 'string' || !runtime.revision.trim()
    || typeof runtime.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(runtime.sha256)
    || typeof runtime.bytes !== 'number' || !Number.isSafeInteger(runtime.bytes) || runtime.bytes <= 0) {
    throw new Error('[codex-top-fingerprint] missing producing Bun identity');
  }
  if (!metafile.inputs || typeof metafile.inputs !== 'object' || Array.isArray(metafile.inputs) || Object.keys(metafile.inputs).length === 0) {
    throw new Error('[codex-top-fingerprint] missing actual Bun inputs');
  }
  const files = new Map<string, { digest: string; bytes: number }>();
  const readPaths = new Set<string>();
  const checkedDirectories = new Set<string>();

  /** /var 等仓库路径别名先映射到已核实根目录，仍拒绝任何仓外输入。 */
  function resolveInput(input: string): string {
    const path = resolve(repositoryAlias, input);
    if (within(repositoryAlias, path)) return join(repoRoot, relative(repositoryAlias, path));
    if (within(repoRoot, path)) return path;
    throw new Error('[codex-top-fingerprint] input escapes repository');
  }

  /** 不可变快照的随机目录名不属于源码语义，归一为固定的私有占位名称。 */
  function nameFor(path: string): string {
    return within(sourceRoot, path)
      ? `apps/cli/<snapshot>/${relative(sourceRoot, path).split(sep).join('/')}`
      : relative(repoRoot, path).split(sep).join('/');
  }

  /** 每次只读仓内普通文件，同时覆盖真实目标，拒绝缺文件和外部符号链接。 */
  async function addFile(path: string): Promise<string> {
    if (!within(repoRoot, path)) throw new Error('[codex-top-fingerprint] input escapes repository');
    const physical = await realpath(path);
    if (!within(repoRoot, physical)) throw new Error('[codex-top-fingerprint] input symlink escapes repository');
    if (!(await lstat(physical)).isFile()) throw new Error('[codex-top-fingerprint] input must be a regular file');
    if (readPaths.has(path)) return physical;
    const bytes = await readFile(physical);
    const record = { digest: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    // 两种路径均使用仓内相对名；内部链接换目标或作用域时也会改变指纹。
    for (const name of new Set([nameFor(path), nameFor(physical)])) {
      const previous = files.get(name);
      if (previous && (previous.digest !== record.digest || previous.bytes !== record.bytes)) throw new Error('[codex-top-fingerprint] conflicting normalized input');
      files.set(name, record);
    }
    readPaths.add(path);
    return physical;
  }

  /** 读取全部祖先 package.json，包含内层 type 与外层 exports，目录只检查一次。 */
  async function addPackageScopes(directory: string): Promise<void> {
    while (within(repoRoot, directory) && !checkedDirectories.has(directory)) {
      checkedDirectories.add(directory);
      const packagePath = join(directory, 'package.json');
      let present = false;
      try { await lstat(packagePath); present = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (present) await addFile(packagePath);
      if (directory === repoRoot) break;
      directory = dirname(directory);
    }
  }

  for (const input of Object.keys(metafile.inputs).sort()) {
    const path = resolveInput(input);
    const physical = await addFile(path);
    await addPackageScopes(dirname(path));
    if (physical !== path) await addPackageScopes(dirname(physical));
  }
  for (const path of [
    join(sourceRoot, 'package.json'), join(sourceRoot, 'tsconfig.json'),
    join(repoRoot, 'apps/cli/package.json'), join(repoRoot, 'apps/cli/tsconfig.json'),
    join(repoRoot, 'package.json'), join(repoRoot, 'yarn.lock'), resolveInput(params.bundleScriptPath),
  ]) await addFile(path);

  const fingerprint = createHash('sha256');
  fingerprint.update(stableJson({ schemaVersion: 1, profile: params.profile, target: params.target, releaseVersion: params.releaseVersion,
    bun: { version: runtime.version, revision: runtime.revision, sha256: runtime.sha256, bytes: runtime.bytes } }));
  for (const [name, record] of [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    fingerprint.update(stableJson([name, record.bytes, record.digest]));
  }
  return fingerprint.digest('hex');
}
