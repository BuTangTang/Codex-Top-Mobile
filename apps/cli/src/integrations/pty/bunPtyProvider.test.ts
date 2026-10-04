import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PtyProvider } from './ptyProvider';
import { createBunPtyProvider, type BunPtyRuntime } from './bunPtyProvider';

const cliRoot = fileURLToPath(new URL('../../../', import.meta.url));
const originalBunVersion = Object.getOwnPropertyDescriptor(process.versions, 'bun');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalBunVersion) Object.defineProperty(process.versions, 'bun', originalBunVersion);
  else Reflect.deleteProperty(process.versions, 'bun');
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

/** 构建真实产品别名；只隔离 native 模块加载这一外部系统边界。 */
async function loadProvider(product: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'happier-bun-pty-selection-'));
  temporaryDirectories.push(directory);
  vi.stubEnv('HAPPIER_HOME_DIR', directory);
  vi.stubEnv('HOME', directory);
  await symlink(join(cliRoot, '../../node_modules'), join(directory, 'node_modules'), 'dir');
  const moduleBoundary = join(directory, 'native-module-boundary.mjs');
  await writeFile(moduleBoundary, "export function createRequire(){return ()=>{throw new Error('native module unavailable in fixture')}}");
  const entry = join(directory, 'provider.mjs');
  await build({
    absWorkingDir: cliRoot,
    stdin: { contents: "export { createNodePtyProvider } from '@/integrations/pty/ptyProvider'", resolveDir: cliRoot, loader: 'ts' },
    bundle: true, outfile: entry, platform: 'node', format: 'esm', packages: 'external',
    alias: {
      ...(product ? { '@/runtime/productCapabilities': join(cliRoot, 'src/runtime/profiles/codexTopCapabilities.ts') } : {}),
      'node:module': moduleBoundary,
      '@': join(cliRoot, 'src'),
    }, logLevel: 'silent',
  });
  return await import(pathToFileURL(entry).href) as typeof import('./ptyProvider');
}

describe('Codex Top Bun PTY selection', () => {
  it('uses Bun terminal without attempting a native fallback in the macOS Bun product', async () => {
    Object.defineProperty(process.versions, 'bun', { value: '1.4.2', configurable: true });
    const spawn = vi.fn(() => { throw new Error('fixture Bun spawn reached'); });
    vi.stubGlobal('Bun', { spawn });
    const fallback: PtyProvider = { spawn: vi.fn(() => { throw new Error('fixture native fallback reached'); }) };
    const { createNodePtyProvider } = await loadProvider(true);
    expect(() => createNodePtyProvider({ platform: 'darwin', fallbackProvider: fallback })
      .spawn({ file: '/fixture/command', args: [], options: {} })).toThrow('fixture Bun spawn reached');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(fallback.spawn).not.toHaveBeenCalled();
  });

  it.each([
    { product: false, bun: true, platform: 'darwin' as const },
    { product: true, bun: false, platform: 'darwin' as const },
    { product: true, bun: true, platform: 'linux' as const },
  ])('preserves the original provider for $product/$bun/$platform', async ({ product, bun, platform }) => {
    if (bun) Object.defineProperty(process.versions, 'bun', { value: '1.4.2', configurable: true });
    const spawn = vi.fn(() => { throw new Error('unexpected Bun spawn'); });
    vi.stubGlobal('Bun', { spawn });
    const fallback: PtyProvider = { spawn: vi.fn(() => { throw new Error('fixture native fallback reached'); }) };
    const { createNodePtyProvider } = await loadProvider(product);
    expect(() => createNodePtyProvider({ platform, fallbackProvider: fallback })
      .spawn({ file: '/fixture/command', args: [], options: {} })).toThrow('fixture native fallback reached');
    expect(spawn).not.toHaveBeenCalled();
  });
});

/** 只模拟 Bun 的系统回调，可明确安排 EOF、进程退出与同步回调的先后。 */
function createRuntimeFixture(onSpawn?: (options: Parameters<BunPtyRuntime['spawn']>[1]) => void) {
  let callbacks!: Parameters<BunPtyRuntime['spawn']>[1];
  const terminal = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
  const child = { terminal, kill: vi.fn() };
  const spawn = vi.fn<BunPtyRuntime['spawn']>((_command, options) => {
    callbacks = options;
    onSpawn?.(options);
    return child;
  });
  return {
    spawn, terminal, child,
    provider: createBunPtyProvider({ spawn }),
    data: (data: Uint8Array) => callbacks.terminal.data(terminal, data),
    eof: (code = 0) => callbacks.terminal.exit(terminal, code),
    exit: (code: number | null, signal: string | number | null = null) => callbacks.onExit(child, code, signal),
  };
}

const command = { file: '/fixture/command', args: ['one two'], options: {} };

describe('Bun PTY event and control contract', () => {
  it('forwards the command, cwd, environment, dimensions and terminal controls without mutating input', () => {
    const fixture = createRuntimeFixture();
    const env = { TERM: 'old-term', PATH: '/fixture', TMUX: 'explicit-keep' };
    const pty = fixture.provider.spawn({ ...command, options: { cwd: '/fixture path', env, cols: 100, rows: 32, name: 'xterm-256color' } });
    expect(fixture.spawn).toHaveBeenCalledWith(['/fixture/command', 'one two'], expect.objectContaining({
      cwd: '/fixture path', env: { ...env, TERM: 'xterm-256color', PWD: '/fixture path' },
      terminal: expect.objectContaining({ name: 'xterm-256color', cols: 100, rows: 32 }),
    }));
    expect(env.TERM).toBe('old-term');
    pty.write('你好\n');
    pty.resize(120, 40);
    pty.kill();
    pty.kill('SIGTERM');
    expect(fixture.terminal.write).toHaveBeenCalledWith('你好\n');
    expect(fixture.terminal.resize).toHaveBeenCalledWith(120, 40);
    expect(fixture.child.kill.mock.calls).toEqual([['SIGHUP'], ['SIGTERM']]);
  });

  it('keeps split UTF-8 intact and never confuses successful EOF with process exit 7', () => {
    const fixture = createRuntimeFixture();
    const pty = fixture.provider.spawn(command);
    const data = vi.fn();
    const exit = vi.fn();
    pty.onData(data);
    pty.onExit(exit);
    const bytes = Buffer.from('你🙂好');
    fixture.data(bytes.subarray(0, 2));
    fixture.data(bytes.subarray(2, 5));
    fixture.data(bytes.subarray(5));
    fixture.eof(0);
    expect(data.mock.calls.flat().join('')).toBe('你🙂好');
    expect(exit).not.toHaveBeenCalled();
    fixture.exit(7);
    fixture.eof();
    fixture.exit(0);
    expect(exit.mock.calls).toEqual([[{ exitCode: 7 }]]);
    expect(fixture.terminal.close).toHaveBeenCalledTimes(1);
    const lateExit = vi.fn();
    pty.onExit(lateExit);
    expect(lateExit).toHaveBeenCalledWith({ exitCode: 7 });
  });

  it('delivers trailing data before publishing a process exit that arrived first', () => {
    const fixture = createRuntimeFixture();
    const pty = fixture.provider.spawn(command);
    const events: string[] = [];
    pty.onData(data => events.push(data));
    pty.onExit(event => events.push(`exit:${event.exitCode}`));
    fixture.exit(23);
    expect(events).toEqual([]);
    fixture.data(Buffer.from('tail'));
    fixture.eof();
    expect(events).toEqual(['tail', 'exit:23']);
  });

  it('handles callbacks fired inside spawn before the child object is returned', () => {
    const fixture = createRuntimeFixture(options => {
      const terminal = { write: () => {}, resize: () => {}, close: () => {} };
      options.terminal.data(terminal, Buffer.from('early'));
      options.onExit({ terminal, kill: () => {} }, 9, null);
      options.terminal.exit(terminal, 0);
    });
    const pty = fixture.provider.spawn(command);
    const data = vi.fn();
    const exit = vi.fn();
    pty.onData(data);
    pty.onExit(exit);
    expect(data).toHaveBeenCalledWith('early');
    expect(exit).toHaveBeenCalledWith({ exitCode: 9 });
    expect(fixture.terminal.close).toHaveBeenCalledTimes(1);
  });

  it('disposes listeners independently and rejects input after exit', () => {
    const fixture = createRuntimeFixture();
    const pty = fixture.provider.spawn(command);
    const removed = vi.fn();
    const retained = vi.fn();
    const removedExit = vi.fn();
    const retainedExit = vi.fn();
    pty.onData(removed).dispose();
    pty.onData(retained);
    pty.onExit(removedExit).dispose();
    pty.onExit(retainedExit);
    fixture.data(Buffer.from('visible'));
    fixture.eof();
    fixture.exit(143, 'SIGTERM');
    expect(removed).not.toHaveBeenCalled();
    expect(removedExit).not.toHaveBeenCalled();
    expect(retained).toHaveBeenCalledWith('visible');
    expect(retainedExit).toHaveBeenCalledWith({ exitCode: 143, signal: 15 });
    expect(() => pty.write('late')).toThrow('terminal_pty_input_closed');
    expect(() => pty.resize(80, 24)).toThrow('terminal_pty_input_closed');
    pty.kill();
    expect(fixture.child.kill).not.toHaveBeenCalled();
  });

  it('preserves numeric signals and reports a missing exit code as unknown rather than success', () => {
    const fixture = createRuntimeFixture();
    const pty = fixture.provider.spawn(command);
    const exit = vi.fn();
    pty.onExit(exit);
    fixture.eof(1);
    fixture.exit(null, 9);
    expect(exit).toHaveBeenCalledWith({ exitCode: -1, signal: 9 });
  });

  it('rejects Unix string arguments and unsupported modes before spawning a child', () => {
    const fixture = createRuntimeFixture();
    expect(() => fixture.provider.spawn({ ...command, args: 'one two' })).toThrow('args as a string is not supported on unix.');
    expect(() => fixture.provider.spawn({ ...command, options: { encoding: null } })).toThrow('terminal_bun_pty_binary_encoding_unavailable');
    expect(() => fixture.provider.spawn({ ...command, options: { handleFlowControl: true } })).toThrow('terminal_bun_pty_flow_control_unavailable');
    expect(fixture.spawn).not.toHaveBeenCalled();
  });
});
