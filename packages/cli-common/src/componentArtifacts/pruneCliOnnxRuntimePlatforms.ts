import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// 仅识别已核对的 ONNX 1.21.0 loader：它只从 process.platform/process.arch 对应目录加载。
// 上游 loader 或版本变化时保留完整包，不能把旧路径推断用于新版本。
const KNOWN_BINDING_SHA256 = '266a182fa5802f8f76c93979663eb572e0164577f4f59bd70bbb92c4accb83aa';
const PLATFORMS = ['darwin', 'linux', 'win32'];
const ARCHITECTURES = ['arm64', 'x64'];

/** 缺失是可保留的未知布局；符号链接不能参与读取或删除，防止越过候选 payload。 */
async function inspectEntry(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) {
      throw new Error('[component-artifacts] refusing symbolic links in ONNX runtime pruning');
    }
    return entry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** 沿已知相对目录逐层确认真实目录，不跟随作用域目录或包目录中的链接。 */
async function inspectDirectory(root: string, segments: readonly string[]): Promise<string | null> {
  let path = root;
  if (!(await inspectEntry(path))?.isDirectory()) return null;
  for (const segment of segments) {
    path = join(path, segment);
    if (!(await inspectEntry(path))?.isDirectory()) return null;
  }
  return path;
}

/**
 * 仅裁剪固定 Transformers 闭包内、已核实版本的 ONNX 非目标操作系统目录。
 * 目标 OS 的所有架构与动态库保持；未知元数据或布局不裁剪，不扫描其它同名包。
 * 调用方必须在独占的新候选 payload 上、依赖复制完成后且签名前调用。
 */
export async function pruneCliOnnxRuntimePlatforms(params: Readonly<{
  payloadDir: string;
  targetOs: string;
}>): Promise<void> {
  const platform = params.targetOs === 'windows' ? 'win32' : params.targetOs;
  if (!PLATFORMS.includes(platform)) return;
  const packageDir = await inspectDirectory(params.payloadDir,
    ['node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-node']);
  if (!packageDir) return;
  const packagePath = join(packageDir, 'package.json');
  if (!(await inspectEntry(packagePath))?.isFile()) return;
  let metadata: unknown;
  try {
    metadata = JSON.parse(await readFile(packagePath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return;
  const packageInfo = metadata as Record<string, unknown>;
  if (packageInfo.name !== 'onnxruntime-node' || packageInfo.version !== '1.21.0'
    || packageInfo.main !== 'dist/index.js') return;
  const distDir = await inspectDirectory(packageDir, ['dist']);
  if (!distDir) return;
  const bindingPath = join(distDir, 'binding.js');
  if (!(await inspectEntry(bindingPath))?.isFile()) return;
  const bindingHash = createHash('sha256').update(await readFile(bindingPath)).digest('hex');
  if (bindingHash !== KNOWN_BINDING_SHA256) return;

  const binariesDir = await inspectDirectory(packageDir, ['bin', 'napi-v3']);
  if (!binariesDir) return;
  const platforms = await readdir(binariesDir);
  if (!platforms.includes(platform)) return;
  // 全部验证结束才删除：后面的异常平台或链接不能导致前面已被部分裁剪。
  for (const os of platforms) {
    const osDir = join(binariesDir, os);
    const osInfo = await inspectEntry(osDir);
    if (!osInfo?.isDirectory() || !PLATFORMS.includes(os)) return;
    const architectures = await readdir(osDir);
    if (architectures.length === 0) return;
    for (const arch of architectures) {
      const archDir = join(osDir, arch);
      if (!(await inspectEntry(archDir))?.isDirectory() || !ARCHITECTURES.includes(arch)) return;
      const entries = await readdir(archDir);
      if (!entries.includes('onnxruntime_binding.node')) return;
      for (const name of entries) {
        if (!(await inspectEntry(join(archDir, name)))?.isFile()) return;
      }
    }
  }
  for (const os of platforms) {
    if (os !== platform) await rm(join(binariesDir, os), { recursive: true, force: false });
  }
}
