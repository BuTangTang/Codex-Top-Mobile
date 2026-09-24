import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { collectInternalWorkspaceDependencyNames } from '../../apps/stack/scripts/utils/proc/workspace_dependencies.mjs';
import { collectWorkspacePackageJsonPaths } from '../../apps/stack/scripts/utils/proc/workspace_package_manifests.mjs';
import { isHappyMonorepoRoot } from '../../apps/stack/scripts/utils/paths/paths.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const helper = join(repoRoot, 'scripts/codextop/prepareServerWorkspace.mjs');
const selected = ['apps/server', 'packages/agents', 'packages/cli-common', 'packages/protocol',
  'packages/release-runtime', 'packages/privacy-kit'];
const markers = ['apps/ui', 'apps/cli'];

/** 读取真实配置，用于核对准备前后内容，避免另一份手抄依赖图。 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 只复制 Docker 安装阶段需要的真实 manifest 与锁文件到独立临时目录。 */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'codextop-server-workspace-'));
  /** 测试结束只清理本用例创建的临时目录。 */
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['package.json', 'yarn.lock', ...[...selected, ...markers].map(manifestPath)]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), readFileSync(join(repoRoot, path)));
  }
  return root;
}

/** 将工作区目录转为 manifest 相对路径。 */
function manifestPath(directory) {
  return `${directory}/package.json`;
}

/** 通过真实 CLI 入口处理暂存目录，不安装依赖、不构建任何应用。 */
function prepare(root) {
  return execFileSync(process.execPath, [helper, root], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
}

/** 提取指定 Docker 阶段，供安装闭包和源代码来源的契约检查。 */
function dockerStage(name) {
  const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
  const stages = dockerfile.split(/(?=^FROM )/m);
  for (const stage of stages) {
    if (new RegExp(`^FROM [^\n]+ AS ${name}\\s*$`, 'm').test(stage)) return stage;
  }
  assert.fail(`缺少独立 Docker 阶段 ${name}`);
}

/** 构建入口只能安装已收窄的服务端闭包，并保留原生 Node/SQLite 运维入口。 */
test('server-only Docker target isolates installation and reuses source server lifecycle', () => {
  const deps = dockerStage('codex-top-server-deps');
  const builder = dockerStage('codex-top-server-builder');
  const runtime = dockerStage('codex-top-server');
  assert.match(deps, /^FROM node:\$\{NODE_VERSION\} AS codex-top-server-deps/m);
  assert.match(deps, /node scripts\/codextop\/prepareServerWorkspace\.mjs \/repo/);
  assert.ok(deps.indexOf('node scripts/codextop/prepareServerWorkspace.mjs') < deps.indexOf('&& yarn-install-with-retry'));
  assert.match(deps, /--frozen-lockfile/);
  assert.doesNotMatch(deps, /--ignore-scripts|--production\b/);
  for (const directory of [...selected, ...markers]) {
    assert.ok(deps.includes(`COPY ${directory}/package.json ${directory}/`), directory);
  }
  assert.doesNotMatch(deps + builder, /^COPY (?:apps\/(?:ui|cli)(?!\/package\.json)|apps\/(?:docs|website)|packages\/(?:tests|audio-stream-native|sherpa-native))\b/m);
  assert.match(builder, /^FROM codex-top-server-deps AS codex-top-server-builder/m);
  assert.match(builder, /ENV HAPPIER_BUILD_DB_PROVIDERS=sqlite/);
  assert.match(builder, /RUN yarn workspace @happier-dev\/server build/);
  assert.doesNotMatch(builder + runtime, /--from=(?:webapp|server|relay-artifacts)|bun|fetch-verified-release-artifact/);
  for (const directory of selected) {
    assert.ok(runtime.includes(`/repo/${directory} /repo/${directory}`), directory);
  }
  assert.match(runtime, /COPY --from=codex-top-server-builder[^\n]+\/repo\/node_modules \/repo\/node_modules/);
  assert.match(runtime, /ENV HAPPIER_DB_PROVIDER=sqlite/);
  assert.match(runtime, /ENV HAPPIER_SERVER_LIGHT_DATA_DIR=\/data/);
  assert.match(runtime, /USER node/);
  assert.match(runtime, /EXPOSE 3005/);
  assert.match(runtime, /HEALTHCHECK[^\n]+\n\s*CMD \["curl",.*\/ready"\]/);
  assert.match(runtime, /CMD \["run-server"\]/);
});

/** 真实清单经准备后只安装六工作区，同时保留锁文件、覆盖规则和布局探测。 */
test('prepares only the server closure without changing lockfile or package contracts', async (t) => {
  const root = fixture(t);
  const original = readJson(join(root, 'package.json'));
  const lock = readFileSync(join(root, 'yarn.lock'));
  prepare(root);
  const prepared = readJson(join(root, 'package.json'));
  assert.deepEqual(prepared, { ...original, workspaces: { ...original.workspaces, packages: selected } });
  assert.deepEqual(readFileSync(join(root, 'yarn.lock')), lock);
  for (const directory of [...selected, ...markers]) {
    assert.deepEqual(readFileSync(join(root, manifestPath(directory))), readFileSync(join(repoRoot, manifestPath(directory))));
  }
  assert.equal(isHappyMonorepoRoot(root), true);
  const manifests = await collectWorkspacePackageJsonPaths(root);
  assert.deepEqual(manifests.map((path) => relative(root, dirname(path))).sort(), [...selected].sort());
  assert.equal(existsSync(join(root, 'node_modules')), false);
  prepare(root);
  assert.deepEqual(readJson(join(root, 'package.json')), prepared);
});

/** 用暂存目录实际加载既有构建 owner，发现 COPY 缺少脚本依赖时在镜像构建前报错。 */
test('canonical shared build owner imports from the isolated Docker script layout', (t) => {
  const root = fixture(t);
  for (const path of ['scripts/workspaces', 'apps/stack/scripts/utils', 'apps/server/scripts/buildSharedDeps.mjs']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(repoRoot, path), join(root, path), { recursive: true });
  }
  // Docker 会复制 cli-common 源码；这里仅复制其不依赖 dist 的根级运行工具。
  for (const name of readdirSync(join(repoRoot, 'packages/cli-common'))) {
    if (!/\.(?:mjs|cjs)$/.test(name) || /\.test\./.test(name)) continue;
    cpSync(join(repoRoot, 'packages/cli-common', name), join(root, 'packages/cli-common', name));
  }
  // 只重建 Yarn 的工作区符号链接这一文件系统边界，不运行 install、不链接本机已编译产物。
  mkdirSync(join(root, 'node_modules/@happier-dev'), { recursive: true });
  symlinkSync('../../packages/cli-common', join(root, 'node_modules/@happier-dev/cli-common'));
  const output = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const owner = await import('./apps/server/scripts/buildSharedDeps.mjs'); console.log(typeof owner.prepareServerWorkspacePrerequisites);"],
  { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(output.trim(), 'function');
});

/** 两种 Yarn 工作区表示都只收窄成员，布局标记缺失则在写入前报错。 */
test('supports workspace arrays and requires both layout markers before rewriting', (t) => {
  const root = fixture(t);
  const path = join(root, 'package.json');
  const original = readJson(path);
  original.workspaces = original.workspaces.packages;
  writeFileSync(path, JSON.stringify(original));
  prepare(root);
  assert.deepEqual(readJson(path), { ...original, workspaces: selected });
  const before = readFileSync(path);
  rmSync(join(root, 'apps/ui/package.json'));
  assert.throws(() => prepare(root), /layout marker/);
  assert.deepEqual(readFileSync(path), before);
});

/** 从全仓真实清单计算传递依赖，发现未来闭包漂移时要求更新隔离构建入口。 */
test('six selected workspaces equal the actual server build and runtime dependency closure', async () => {
  const byName = new Map();
  for (const path of await collectWorkspacePackageJsonPaths(repoRoot)) {
    const manifest = readJson(path);
    byName.set(manifest.name, { manifest, directory: relative(repoRoot, dirname(path)) });
  }
  const queue = ['@happier-dev/server'];
  const visited = new Set();
  for (const name of queue) {
    if (visited.has(name)) continue;
    visited.add(name);
    const { manifest } = byName.get(name);
    queue.push(...collectInternalWorkspaceDependencyNames(manifest, name, { workspacePackageNames: byName.keys() }));
  }
  assert.deepEqual([...visited].map((name) => byName.get(name).directory).sort(), [...selected].sort());
});

/** 缺少必要 manifest 时不能悄悄转用 registry 包或写出不完整配置。 */
test('missing closure member fails before rewriting the staging root', (t) => {
  const root = fixture(t);
  const before = readFileSync(join(root, 'package.json'));
  rmSync(join(root, 'packages/release-runtime/package.json'));
  assert.throws(() => prepare(root), /release-runtime/);
  assert.deepEqual(readFileSync(join(root, 'package.json')), before);
});

/** 闭包引入 UI 等排除工作区时显式拒绝，不能让 Yarn 从网络补回整个客户端。 */
test('excluded internal dependency fails instead of silently widening installation', (t) => {
  const root = fixture(t);
  const before = readFileSync(join(root, 'package.json'));
  const path = join(root, 'apps/server/package.json');
  const server = readJson(path);
  server.dependencies['@happier-dev/app'] = '0.0.0';
  writeFileSync(path, JSON.stringify(server));
  assert.throws(() => prepare(root), /@happier-dev\/app/);
  assert.deepEqual(readFileSync(join(root, 'package.json')), before);
});

/** 防止维护者误把仅供镜像暂存阶段的裁剪工具运行在共享 Git 工作区。 */
test('refuses an actual checkout or installed workspace', (t) => {
  for (const marker of ['.git', 'node_modules']) {
    const root = fixture(t);
    const before = readFileSync(join(root, 'package.json'));
    mkdirSync(join(root, marker));
    assert.throws(() => prepare(root), /staging/);
    assert.deepEqual(readFileSync(join(root, 'package.json')), before);
  }
});
