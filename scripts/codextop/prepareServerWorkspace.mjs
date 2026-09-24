import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectInternalWorkspaceDependencyNames } from '../../apps/stack/scripts/utils/proc/workspace_dependencies.mjs';

// 此目标只支持已核实的服务端闭包；依赖扩大时显式报错，由镜像 owner 审核 COPY 和资源影响。
const serverWorkspaces = new Map([
  ['apps/server', '@happier-dev/server'],
  ['packages/agents', '@happier-dev/agents'],
  ['packages/cli-common', '@happier-dev/cli-common'],
  ['packages/protocol', '@happier-dev/protocol'],
  ['packages/release-runtime', '@happier-dev/release-runtime'],
  ['packages/privacy-kit', 'privacy-kit'],
]);

/** 仅收窄镜像暂存根清单的 workspaces，保留锁文件、resolutions、nohoist 和全部包契约。 */
export function prepareServerWorkspace(directory) {
  const root = resolve(directory);
  if (existsSync(join(root, '.git')) || existsSync(join(root, 'node_modules'))) {
    throw new Error('Server workspace preparation requires a clean Docker staging directory, not a checkout or installed workspace');
  }
  const rootPath = join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(rootPath, 'utf8'));
  const originalWorkspaces = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages;
  if (!Array.isArray(originalWorkspaces)) throw new Error('Missing staging root workspaces');
  const names = new Set(serverWorkspaces.values());
  for (const [path, name] of serverWorkspaces) {
    if (!originalWorkspaces.includes(path)) throw new Error(`Missing server workspace in root manifest: ${path}`);
    const pkg = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'));
    if (pkg.name !== name) throw new Error(`Unexpected workspace identity at ${path}: ${pkg.name}`);
    // 复用现有依赖识别器：已知集合包含无 scope 的 privacy-kit，默认识别器另外捕获遗漏的内部包。
    const internal = new Set([
      ...collectInternalWorkspaceDependencyNames(pkg, name, { workspacePackageNames: names }),
      ...collectInternalWorkspaceDependencyNames(pkg, name),
    ]);
    for (const dependency of internal) {
      if (!names.has(dependency)) throw new Error(`Server-only staging excludes required workspace: ${dependency}`);
    }
  }
  // 原构建 owner 用两份 manifest 识别 monorepo 布局；保留文件，但不让 Yarn 安装这两个工作区。
  for (const marker of ['apps/ui/package.json', 'apps/cli/package.json']) {
    if (!existsSync(join(root, marker))) throw new Error(`Missing monorepo layout marker: ${marker}`);
  }
  const selected = [...serverWorkspaces.keys()];
  manifest.workspaces = Array.isArray(manifest.workspaces)
    ? selected
    : { ...manifest.workspaces, packages: selected };
  writeFileSync(rootPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return selected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node prepareServerWorkspace.mjs <Docker staging root>');
  prepareServerWorkspace(process.argv[2]);
}
