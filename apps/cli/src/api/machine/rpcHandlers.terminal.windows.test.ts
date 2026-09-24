import { describe, expect, it } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcHandlerManager } from '../rpc/RpcHandlerManager';
import { createTerminalPtySessionManager } from '@/daemon/terminalPty/terminalPtySessionManager';
import type { PtyProcess, PtyProvider, PtySpawnParams } from '@/integrations/pty/ptyProvider';
import { registerMachineTerminalRpcHandlers } from './rpcHandlers.terminal';

class FakePty implements PtyProcess {
  write(): void {}
  resize(): void {}
  kill(): void {}
  onData(_listener: (data: string) => void): { dispose: () => void } { return { dispose: () => {} }; }
  onExit(_listener: (e: { exitCode: number; signal?: number | undefined }) => void): { dispose: () => void } {
    return { dispose: () => {} };
  }
}

class FakePtyProvider implements PtyProvider {
  readonly spawned: PtySpawnParams[] = [];

  spawn(params: PtySpawnParams): PtyProcess {
    this.spawned.push(params);
    return new FakePty();
  }
}

function createFakeTerminalSessionManager(provider: PtyProvider) {
  return createTerminalPtySessionManager({
    ptyProvider: provider,
    env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' } as NodeJS.ProcessEnv,
    platform: 'win32',
    now: () => 0,
    config: {
      maxSessions: 10,
      idleTimeoutMs: 60_000,
      bufferMaxBytes: 1_000_000,
      bufferMaxEvents: 1000,
      urlParseBufferLimit: 32_768,
      maxWriteChunkBytes: 16_384,
      defaultCols: 80,
      defaultRows: 24,
    },
  });
}

describe('registerMachineTerminalRpcHandlers Windows paths', () => {
  it('expands ~\\ cwd from USERPROFILE before applying restricted root policy', async () => {
    const provider = new FakePtyProvider();
    const sessionManager = createFakeTerminalSessionManager(provider);
    const registered = new Map<string, (params: unknown) => Promise<unknown>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: unknown) => Promise<unknown>) => {
        registered.set(method, handler);
      },
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: {
          HAPPIER_DAEMON_TERMINAL_ENABLED: '1',
          USERPROFILE: 'C:\\Users\\alice',
          HOME: '/home/alice',
        },
        platform: 'win32',
        workingDirectory: 'C:\\Users\\alice',
        accessPolicy: {
          kind: 'restrictedRoots',
          roots: ['C:\\Users\\alice\\workspace'],
        },
        sessionManager,
      },
    });

    const ensure = registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE);
    expect(ensure).toBeDefined();

    const result = await ensure!({
      terminalKey: 'workspace',
      cwd: '~\\workspace',
      cols: 80,
      rows: 24,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, reused: false }));
    expect(provider.spawned[0]?.options.cwd).toBe('C:\\Users\\alice\\workspace');
  });
});
