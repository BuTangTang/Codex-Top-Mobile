import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { CODEX_TOP_ARTIFACT_PROFILE as profile } from './codexTopArtifactProfile.js';

type PackageJson = { name: string; version: string; license?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
type InstalledPackage = { root: string; metadata: PackageJson };
type LicenseRecord = { name: string; version: string; license: string | null; licenseTextAvailable: boolean; files: string[] };
type CopyPlan = Map<string, string>;

/** 边界必须带目录分隔符，防止同名前缀目录及绝对外部路径混入。 */
function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** 只把确实不存在作为缺失，其余 IO 错误保留给构建者处理。 */
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** 已知资源不跟随链接，避免复制目标逃离仓库或生成外链。 */
async function validateSource(root: string, path: string): Promise<void> {
  if (!within(root, path)) throw new Error('[codex-top-assets] source escapes repository');
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('[codex-top-assets] refusing symbolic links in runtime assets');
  }
}

/** 先建立完整文件计划，缺文件、外链和目标冲突均在复制前失败。 */
async function planTree(plan: CopyPlan, repoRoot: string, source: string, destination: string): Promise<void> {
  await validateSource(repoRoot, source);
  const info = await lstat(source);
  if (info.isDirectory()) {
    for (const name of (await readdir(source)).sort()) await planTree(plan, repoRoot, join(source, name), `${destination}/${name}`);
    return;
  }
  if (!info.isFile()) throw new Error('[codex-top-assets] runtime asset must be a regular file');
  const previous = plan.get(destination);
  if (previous && previous !== source) {
    const [oldBytes, newBytes] = await Promise.all([readFile(previous), readFile(source)]);
    if (!oldBytes.equals(newBytes)) throw new Error(`[codex-top-assets] conflicting asset: ${destination}`);
  }
  plan.set(destination, source);
}

/** 安装包按调用者的 Node 搜索顺序解析，支持 Sharp 自身的嵌套依赖。 */
async function installedPackage(repoRoot: string, from: string, name: string): Promise<InstalledPackage> {
  for (const modules of createRequire(from).resolve.paths(name) ?? []) {
    const root = join(modules, name);
    if (!within(repoRoot, root)) continue;
    const metadataPath = join(root, 'package.json');
    if (!await exists(metadataPath)) continue;
    await validateSource(repoRoot, metadataPath);
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as PackageJson;
    if (metadata.name !== name) throw new Error(`[codex-top-assets] unexpected package identity: ${name}`);
    return { root, metadata };
  }
  throw new Error(`[codex-top-assets] missing runtime package: ${name}`);
}

/** 最终 payload 不能含链接；检查已有 bundle 及待写路径的所有父级。 */
async function assertNoLinks(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('[codex-top-assets] refusing symbolic links in payload');
  if (info.isDirectory()) for (const name of await readdir(path)) await assertNoLinks(join(path, name));
}

/** 只取 Bun 实际输出中占用字节的模块，排除仅分析过却被消除的依赖。 */
async function retainedPackageRoots(repoRoot: string, metafilePath: string): Promise<string[]> {
  const metafile = JSON.parse(await readFile(metafilePath, 'utf8')) as {
    inputs?: Record<string, unknown>;
    outputs?: Record<string, { inputs?: Record<string, { bytesInOutput?: number }> }>;
  };
  if (!metafile.inputs || !metafile.outputs || Object.keys(metafile.outputs).length === 0) {
    throw new Error('[codex-top-assets] missing Bun retained-input metadata');
  }
  const roots = new Set<string>();
  for (const output of Object.values(metafile.outputs)) {
    if (!output.inputs) throw new Error('[codex-top-assets] output has no retained-input metadata');
    for (const [input, contribution] of Object.entries(output.inputs)) {
      if (typeof contribution.bytesInOutput !== 'number' || !Number.isFinite(contribution.bytesInOutput) || contribution.bytesInOutput < 0) {
        throw new Error('[codex-top-assets] invalid retained-input byte count');
      }
      if (contribution.bytesInOutput === 0) continue;
      if (!Object.prototype.hasOwnProperty.call(metafile.inputs, input)) throw new Error('[codex-top-assets] retained input absent from Bun inputs');
      const path = resolve(repoRoot, input);
      if (!within(repoRoot, path)) throw new Error('[codex-top-assets] metafile input escapes repository');
      const resolved = await realpath(path);
      if (!within(repoRoot, resolved)) throw new Error('[codex-top-assets] metafile symlink escapes repository');
      const parts = relative(repoRoot, path).split(sep);
      const modulesIndex = parts.lastIndexOf('node_modules');
      if (modulesIndex < 0) continue;
      const packageName = parts[modulesIndex + 1];
      if (!packageName) throw new Error('[codex-top-assets] invalid package input');
      const root = join(repoRoot, ...parts.slice(0, modulesIndex + (packageName.startsWith('@') ? 3 : 2)));
      const resolvedRoot = await realpath(root);
      if (!within(repoRoot, resolvedRoot)) throw new Error('[codex-top-assets] package root escapes repository');
      roots.add(resolvedRoot);
    }
  }
  return [...roots].sort();
}

/** 保留随包提供的许可和 NOTICE；只有声明或 README 时明确标记原文缺口。 */
async function planLicense(plan: CopyPlan, repoRoot: string, pkg: InstalledPackage): Promise<LicenseRecord> {
  const { name, version, license } = pkg.metadata;
  if (typeof name !== 'string' || !name || typeof version !== 'string' || !version) throw new Error('[codex-top-assets] package attribution requires name/version');
  const entries = (await readdir(pkg.root)).sort();
  let selected = entries.filter((entry) => /^(licen[cs]e|copying|notice|copyright)([.\-_]|$)/i.test(entry));
  const licenseTextAvailable = selected.some((entry) => /^(licen[cs]e|copying)([.\-_]|$)/i.test(entry));
  if (!licenseTextAvailable) selected = [...new Set([...selected, ...entries.filter((entry) => /^readme([.\-_]|$)/i.test(entry))])].sort();
  const directory = `licenses/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  const files: string[] = [];
  for (const entry of selected) {
    const destination = `${directory}/${entry}`;
    await planTree(plan, repoRoot, join(pkg.root, entry), destination);
    for (const target of plan.keys()) if (target === destination || target.startsWith(`${destination}/`)) files.push(target);
  }
  return { name, version, license: typeof license === 'string' ? license : null, licenseTextAvailable, files: [...new Set(files)].sort() };
}

/** 复制已验证平台的运行资源；Bun bundle 已冻结，资源异常只令候选构建失败。 */
export async function copyCodexTopRuntimeAssets(params: Readonly<{
  repoRoot: string;
  payloadDir: string;
  metafilePath: string;
}>): Promise<void> {
  const repoRoot = await realpath(params.repoRoot);
  await assertNoLinks(resolve(params.payloadDir));
  const payloadDir = await realpath(params.payloadDir);
  const plan: CopyPlan = new Map();
  const cliPackagePath = join(repoRoot, 'apps/cli/package.json');
  const sharp = await installedPackage(repoRoot, cliPackagePath, 'sharp');
  const packages: InstalledPackage[] = [];
  for (const spec of [...profile.nativePackages, ...profile.runtimePackages]) {
    const from = spec.name.startsWith('@img/') || profile.runtimePackages.some((runtime) => runtime.name === spec.name)
      ? join(sharp.root, 'package.json') : cliPackagePath;
    const pkg = await installedPackage(repoRoot, from, spec.name);
    if (pkg.metadata.version !== spec.version) throw new Error(`[codex-top-assets] unsupported runtime version: ${spec.name}`);
    if (profile.runtimePackages.some((runtime) => runtime.name === spec.name)
      && (Object.keys(pkg.metadata.dependencies ?? {}).length || Object.keys(pkg.metadata.optionalDependencies ?? {}).length)) {
      throw new Error(`[codex-top-assets] unreviewed JS runtime dependency: ${spec.name}`);
    }
    for (const entry of spec.entries) await planTree(plan, repoRoot, join(pkg.root, entry), `node_modules/${spec.name}/${entry}`);
    packages.push(pkg);
  }
  const expectedSharpDeps = profile.runtimePackages.map((pkg) => pkg.name).sort();
  if (JSON.stringify(Object.keys(sharp.metadata.dependencies ?? {}).sort()) !== JSON.stringify(expectedSharpDeps)) throw new Error('[codex-top-assets] unreviewed Sharp dependency closure');
  const fallback = packages.find((pkg) => pkg.metadata.name === '@homebridge/node-pty-prebuilt-multiarch')!;
  for (const path of ['prebuilds/darwin-arm64', 'build/Release/pty.node', 'build/Debug/pty.node']) {
    if (await exists(join(fallback.root, path))) throw new Error('[codex-top-assets] unreviewed PTY fallback native layout');
  }
  for (const entry of profile.sidecars) await planTree(plan, repoRoot, join(repoRoot, 'apps/cli/scripts', entry), `scripts/${entry}`);
  for (const root of await retainedPackageRoots(repoRoot, params.metafilePath)) {
    await validateSource(repoRoot, join(root, 'package.json'));
    const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageJson;
    if (!metadata.name?.startsWith('@happier-dev/')) packages.push({ root, metadata });
  }
  const records = new Map<string, LicenseRecord>();
  for (const pkg of packages) {
    const record = await planLicense(plan, repoRoot, pkg);
    const key = `${record.name}@${record.version}`;
    const previous = records.get(key);
    if (previous && previous.license !== record.license) throw new Error(`[codex-top-assets] conflicting attribution: ${key}`);
    records.set(key, previous ? { ...record, licenseTextAvailable: previous.licenseTextAvailable || record.licenseTextAvailable, files: [...new Set([...previous.files, ...record.files])].sort() } : record);
  }
  const cli = await planLicense(plan, repoRoot, { root: dirname(cliPackagePath), metadata: JSON.parse(await readFile(cliPackagePath, 'utf8')) });
  const indexPath = join(payloadDir, 'licenses/index.json');
  if (await exists(indexPath)) throw new Error('[codex-top-assets] refusing to replace an existing license index');
  for (const destination of plan.keys()) if (await exists(join(payloadDir, destination))) throw new Error(`[codex-top-assets] refusing to replace existing asset: ${destination}`);
  for (const [destination, source] of plan) {
    const output = join(payloadDir, destination);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(source, output);
    // 上游安装包中的 helper 可能只有 0644；只修复产物中这个必需的可执行程序。
    if (destination === 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper') await chmod(output, 0o755);
  }
  // 索引只含包身份与 payload 相对路径，绝不保存构建机绝对路径或原始 metafile。
  const index = { schemaVersion: 1, cli, packages: [...records.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)) };
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}
