import { constants } from 'node:os';
import { StringDecoder } from 'node:string_decoder';

import type { PtyExitEvent, PtyProvider } from './ptyProvider';

type BunTerminal = Readonly<{
  write: (data: string) => unknown;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}>;

type BunSubprocess = Readonly<{
  terminal: BunTerminal;
  kill: (signal?: string) => void;
}>;

/** 仅描述本适配器使用的 Bun 系统边界，不在 Node 构建中引入 Bun 全局类型。 */
export type BunPtyRuntime = Readonly<{
  spawn: (command: string[], options: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    terminal: Readonly<{
      name: string;
      cols: number;
      rows: number;
      data: (terminal: BunTerminal, data: Uint8Array) => void;
      exit: (terminal: BunTerminal, code: number) => void;
    }>;
    onExit: (process: BunSubprocess, exitCode: number | null, signal: string | number | null) => void;
  }>) => BunSubprocess;
}>;

/** 只在真实 Bun 路径读取其运行时 API；缺失时明确失败，不另起外部解释器。 */
function resolveBunRuntime(): BunPtyRuntime {
  // Bun 是此 Node 类型工程中的外部系统边界，先检查实际方法再收窄。
  const runtime = (globalThis as { Bun?: Partial<BunPtyRuntime> }).Bun;
  if (typeof runtime?.spawn !== 'function') throw new Error('terminal_bun_pty_unavailable');
  return runtime as BunPtyRuntime;
}

/** 将 Bun 的进程信号保留为现有 PTY 消费者使用的数字信号。 */
function processExitEvent(exitCode: number | null, signal: string | number | null): PtyExitEvent {
  const numericSignal = typeof signal === 'number'
    ? signal
    : signal ? constants.signals[signal as NodeJS.Signals] : undefined;
  return {
    exitCode: exitCode ?? -1,
    ...(typeof numericSignal === 'number' ? { signal: numericSignal } : {}),
  };
}

/** 复用现有 PTY 契约；进程退出和终端流关闭都完成后才发布退出，避免丢尾部输出。 */
export function createBunPtyProvider(runtime: BunPtyRuntime = resolveBunRuntime()): PtyProvider {
  return {
    spawn: ({ file, args, options }) => {
      if (typeof args === 'string') throw new Error('args as a string is not supported on unix.');
      if (options.handleFlowControl) throw new Error('terminal_bun_pty_flow_control_unavailable');
      if (options.encoding === null) throw new Error('terminal_bun_pty_binary_encoding_unavailable');
      const encoding = options.encoding ?? 'utf8';
      if (!Buffer.isEncoding(encoding)) throw new Error('terminal_bun_pty_encoding_invalid');
      const decoder = new StringDecoder(encoding);
      const dataListeners = new Set<(data: string) => void>();
      const exitListeners = new Set<(event: PtyExitEvent) => void>();
      const synchronousData: string[] = [];
      let spawning = true;
      let streamClosed = false;
      let processExit: PtyExitEvent | null = null;
      let completedExit: PtyExitEvent | null = null;
      let terminalClosed = false;
      let child: BunSubprocess | undefined;

      const emitData = (data: string) => {
        if (!data) return;
        if (spawning) synchronousData.push(data);
        else for (const listener of dataListeners) listener(data);
      };
      const complete = () => {
        if (!streamClosed || !processExit || completedExit) return;
        completedExit = processExit;
        if (child && !terminalClosed) {
          terminalClosed = true;
          child.terminal.close();
        }
        for (const listener of exitListeners) listener(completedExit);
        exitListeners.clear();
        dataListeners.clear();
      };
      const cwd = options.cwd || process.cwd();
      const sourceEnv = options.env ?? process.env;
      const env = { ...sourceEnv };
      if (sourceEnv === process.env) {
        // 与 Unix node-pty 一样，仅清理继承的宿主终端标记，不改调用方显式环境。
        for (const key of ['TMUX', 'TMUX_PANE', 'STY', 'WINDOW', 'WINDOWID', 'TERMCAP', 'COLUMNS', 'LINES']) delete env[key];
      }
      const name = options.name || env.TERM || 'xterm';
      env.TERM = name;
      env.PWD = cwd;
      child = runtime.spawn([file, ...args], {
        cwd, env,
        terminal: {
          name, cols: options.cols || 80, rows: options.rows || 24,
          data: (_terminal, data) => {
            if (!streamClosed) emitData(decoder.write(Buffer.from(data)));
          },
          exit: () => {
            if (streamClosed) return;
            streamClosed = true;
            emitData(decoder.end());
            complete();
          },
        },
        onExit: (_process, exitCode, signal) => {
          if (!processExit) processExit = processExitEvent(exitCode, signal);
          complete();
        },
      });
      spawning = false;
      // Bun 可以在 spawn 返回之前回调 onExit；此时对象赋值后再关闭终端。
      if (completedExit && !terminalClosed) {
        terminalClosed = true;
        child.terminal.close();
      }

      return {
        write: (data) => {
          if (streamClosed || processExit) throw new Error('terminal_pty_input_closed');
          child.terminal.write(data);
        },
        resize: (cols, rows) => {
          if (streamClosed || processExit) throw new Error('terminal_pty_input_closed');
          child.terminal.resize(cols, rows);
        },
        kill: (signal) => {
          if (!processExit) child.kill(signal || 'SIGHUP');
        },
        onData: (listener) => {
          if (!completedExit) dataListeners.add(listener);
          for (const data of synchronousData.splice(0)) listener(data);
          return { dispose: () => { dataListeners.delete(listener); } };
        },
        onExit: (listener) => {
          if (completedExit) listener(completedExit);
          else exitListeners.add(listener);
          return { dispose: () => { exitListeners.delete(listener); } };
        },
      };
    },
  };
}
