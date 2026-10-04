import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import cliDistBuildManifest from '@happier-dev/cli-common/cliDistBuildManifest';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';

const cliRoot = fileURLToPath(new URL('../../../', import.meta.url));
const childMarker = '__synthetic_child__';
const daemonArgs = ['daemon', 'start-sync', '--takeover', childMarker];
const runnerArgs = ['codex', '--started-by', 'daemon', '--existing-session', 'synthetic-session', '--happy-starting-mode', 'remote', childMarker];

type ChildObservation = Readonly<{ execPath: string; args: string[]; assetExists: boolean; selfContained: boolean }>;
type ProbeObservation = Readonly<{
  daemon: { spec: { filePath: string; args: string[] }; child: ChildObservation } | null;
  daemonError: string | null;
  runner: { spec: { filePath: string; args: string[] }; child: ChildObservation };
  networkAttempts: number;
  subprocessOverrides: string[];
}>;

let temporaryRoot = '';
let bunExecutable = '';
let bundledSource = '';
let fixtureSequence = 0;

/** 只编译真实共享入口与解析 owner；合成 dispatch 不启动账号、服务器或 provider。 */
async function prepareProbe(): Promise<void> {
  temporaryRoot = realpathSync(await createTempDir('codex-top-bun-layout-', cliRoot));
  const bunCommand = process.env.HAPPIER_BUN_PATH || 'bun';
  bunExecutable = realpathSync(execFileSync(bunCommand, ['-e', 'process.stdout.write(process.execPath)'], { encoding: 'utf8' }));
  const entry = join(temporaryRoot, 'probe.ts');
  const module = (path: string) => JSON.stringify(join(cliRoot, 'src', path));
  writeFileSync(entry, `
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { runCliEntrypoint } from ${module('cli/runtime/runCliEntrypoint')};
import { resolveDaemonLaunchSpec } from ${module('daemon/runtime/resolveDaemonLaunchSpec')};
import { buildHappyCliSubprocessLaunchSpec } from ${module('utils/spawnHappyCLI')};
import { resolveCliRuntimeAssetPath, isSelfContainedCliBinary } from ${module('runtime/assets/resolveCliRuntimeAssetPath')};
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('synthetic network denied'); };
runCliEntrypoint({ moduleUrl: import.meta.url, dispatch: async ({ args }) => {
  if (args.includes(${JSON.stringify(childMarker)})) {
    console.log(JSON.stringify({ execPath: process.execPath, args, assetExists: existsSync(resolveCliRuntimeAssetPath('scripts', ${JSON.stringify('synthetic-asset.cjs')})), selfContained: isSelfContainedCliBinary() }));
    return;
  }
  const launch = (spec) => {
    const child = spawnSync(spec.filePath, spec.args, { env: process.env, encoding: 'utf8', timeout: 10000 });
    if (child.error || child.status !== 0) throw child.error ?? new Error(child.stderr);
    return JSON.parse(child.stdout);
  };
  const runnerSpec = buildHappyCliSubprocessLaunchSpec(${JSON.stringify(runnerArgs)});
  const runner = { spec: runnerSpec, child: launch(runnerSpec) };
  let daemon = null;
  let daemonError = null;
  try {
    const spec = await resolveDaemonLaunchSpec(${JSON.stringify(daemonArgs)});
    daemon = { spec, child: launch(spec) };
  } catch (error) { daemonError = String(error); }
  console.log(JSON.stringify({ daemon, daemonError, runner, networkAttempts, subprocessOverrides: Object.keys(process.env).filter(key => key.startsWith('HAPPIER_CLI_SUBPROCESS_')) }));
} });
`, 'utf8');
  const descriptor = join(cliRoot, 'src/runtime/profiles/codexTopCapabilities.ts');
  const result = await build({
    absWorkingDir: cliRoot, entryPoints: [entry], bundle: true, write: false,
    platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    alias: {
      '@': join(cliRoot, 'src'),
      '@/backends/catalogRegistry': join(cliRoot, 'src/backends/catalogRegistry.codexTop.ts'),
      '@/runtime/productCapabilities': descriptor,
      '@/daemon/memory/daemonMemoryCapability': descriptor,
      '@/rpc/handlers/sessionToolCapabilities': descriptor,
    },
  });
  bundledSource = result.outputFiles[0]!.text;
}

/** 生成物理同包 Bun、JS、资源和原 manifest；临时 HOME 与 PATH 不提供 Node/Bun。 */
function createPayload(): Readonly<{ root: string; entrypoint: string; runtime: string; wrapper: string; home: string }> {
  const root = join(temporaryRoot, `payload with spaces ${++fixtureSequence}`);
  const entrypoint = join(root, 'package-dist', 'index.mjs');
  const runtime = join(root, 'runtime', 'bun');
  const home = join(root, 'isolated-home');
  for (const directory of [dirname(entrypoint), dirname(runtime), home, join(root, 'scripts')]) mkdirSync(directory, { recursive: true });
  copyFileSync(bunExecutable, runtime);
  chmodSync(runtime, 0o755);
  writeFileSync(entrypoint, bundledSource, 'utf8');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@happier-dev/cli', version: '1.0.90-synthetic' }));
  writeFileSync(join(root, 'scripts', 'synthetic-asset.cjs'), 'module.exports = "synthetic";\n');
  const wrapper = join(root, 'happier');
  writeFileSync(wrapper, '#!/bin/sh\nbasedir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)\nexec "$basedir/runtime/bun" "$basedir/package-dist/index.mjs" "$@"\n');
  chmodSync(wrapper, 0o755);
  cliDistBuildManifest.writeCliDistBuildManifest(entrypoint, { buildVersion: '1.0.90-synthetic' });
  cliDistBuildManifest.writeCliRuntimeAssetBuildManifest({ runtimeRoot: root, entrypoint, relativePath: 'runtime/bun' });
  return { root, entrypoint, runtime, wrapper, home };
}

/** 运行真实 wrapper/Bun；只替换外部联网边界，所有内部启动及校验函数保持真实。 */
function invokeProbe(payload: ReturnType<typeof createPayload>, options: Readonly<{ executable?: string; entrypoint?: string }> = {}): ProbeObservation {
  const child = spawnSync(options.executable ?? payload.wrapper, options.executable ? [options.entrypoint ?? payload.entrypoint] : [], {
    encoding: 'utf8', timeout: 20_000,
    env: { HOME: payload.home, HAPPIER_HOME_DIR: payload.home, PATH: '/usr/bin:/bin', HAPPIER_TAILSCALE_AUTO_PUBLIC_URL: '0' },
  });
  if (child.error || child.status !== 0) throw child.error ?? new Error(child.stderr);
  return JSON.parse(child.stdout) as ProbeObservation;
}

/** 缺证据必须停在产品错误出口，不请求网络，也不生成 HOME runtime 回退。 */
function expectRejected(observation: ProbeObservation): void {
  expect(observation.daemon).toBeNull();
  expect(observation.networkAttempts).toBe(0);
  expect(observation.daemonError).toContain('Codex Top bundled Bun');
  expect(observation.subprocessOverrides).toEqual([]);
}

describe.skipIf(process.platform === 'win32')('Codex Top bundled Bun daemon layout', () => {
  beforeAll(prepareProbe, 60_000);
  afterAll(async () => { if (temporaryRoot) await removeTempDir(temporaryRoot); });

  it('launches daemon and managed Codex children through the same physical Bun with spaces and no global runtime', () => {
    const payload = createPayload();
    const observation = invokeProbe(payload);
    expect(observation.daemonError).toBeNull();
    expect(observation.daemon?.spec).toEqual({ filePath: payload.runtime, args: [payload.entrypoint, ...daemonArgs] });
    expect(observation.daemon?.child).toEqual({ execPath: payload.runtime, args: daemonArgs, assetExists: true, selfContained: false });
    expect(observation.runner.spec).toMatchObject({ filePath: payload.runtime, args: [payload.entrypoint, ...runnerArgs] });
    expect(observation.runner.child).toEqual({ execPath: payload.runtime, args: runnerArgs, assetExists: true, selfContained: false });
    expect(observation.networkAttempts).toBe(0);
    expect(observation.subprocessOverrides).toEqual([]);
  }, 30_000);

  it('keeps a valid package relocatable without rewriting its manifest or requiring the old directory', () => {
    const original = createPayload();
    const movedRoot = join(temporaryRoot, 'moved package with spaces');
    renameSync(original.root, movedRoot);
    const payload = { root: movedRoot, entrypoint: join(movedRoot, 'package-dist/index.mjs'), runtime: join(movedRoot, 'runtime/bun'), wrapper: join(movedRoot, 'happier'), home: join(movedRoot, 'isolated-home') };
    const observation = invokeProbe(payload);
    expect(observation.daemonError).toBeNull();
    expect(observation.daemon?.spec).toEqual({ filePath: payload.runtime, args: [payload.entrypoint, ...daemonArgs] });
    expect(observation.daemon?.child.assetExists).toBe(true);
    expect(observation.networkAttempts).toBe(0);
  }, 30_000);

  it('rejects a real Bun from outside the payload even when its bytes match the manifest', () => {
    const payload = createPayload();
    expectRejected(invokeProbe(payload, { executable: bunExecutable }));
  }, 30_000);

  it('rejects a product entrypoint outside package-dist rather than searching another installed runtime', () => {
    const payload = createPayload();
    const entrypoint = join(payload.root, 'dist', 'index.mjs');
    mkdirSync(dirname(entrypoint));
    writeFileSync(entrypoint, bundledSource);
    expectRejected(invokeProbe(payload, { executable: payload.runtime, entrypoint }));
  }, 30_000);

  it('rejects a runtime directory symlink to a different physical package', () => {
    const payload = createPayload();
    const externalRuntime = join(temporaryRoot, 'external runtime');
    renameSync(dirname(payload.runtime), externalRuntime);
    symlinkSync(externalRuntime, dirname(payload.runtime), 'dir');
    expectRejected(invokeProbe(payload));
  }, 30_000);

  it.each(['missing', 'invalid-json', 'js-changed', 'wrong-runtime-asset', 'runtime-sha-changed'] as const)('rejects %s manifest evidence without network or Node fallback', (failure) => {
    const payload = createPayload();
    const manifestPath = join(dirname(payload.entrypoint), '.build-manifest.json');
    if (failure === 'missing') rmSync(manifestPath);
    if (failure === 'invalid-json') writeFileSync(manifestPath, '{broken');
    if (failure === 'js-changed') writeFileSync(payload.entrypoint, `${bundledSource}\n// changed after manifest\n`);
    if (failure === 'wrong-runtime-asset') cliDistBuildManifest.writeCliRuntimeAssetBuildManifest({ runtimeRoot: payload.root, entrypoint: payload.entrypoint, relativePath: 'happier' });
    if (failure === 'runtime-sha-changed') {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.runtimeAsset.sha256 = '0'.repeat(64);
      writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    expectRejected(invokeProbe(payload));
  }, 30_000);
});
