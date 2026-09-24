import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Machine } from '@/api/types';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const { spawnedPtys } = vi.hoisted(() => ({
  spawnedPtys: [] as unknown[],
}));

vi.mock('@/integrations/pty/ptyProvider', () => ({
  createNodePtyProvider: () => ({
    spawn: (params: unknown) => {
      spawnedPtys.push(params);
      return {
        write: () => {},
        resize: () => {},
        kill: () => {},
        onData: () => ({ dispose: () => {} }),
        onExit: () => ({ dispose: () => {} }),
      };
    },
  }),
}));

import { ApiMachineClient } from './apiMachine';

const tempDirectories: string[] = [];

function createMachine(): Machine {
  return {
    id: 'machine-test',
    encryptionKey: new Uint8Array(32).fill(7),
    encryptionVariant: 'legacy',
    metadata: null,
    metadataVersion: 0,
    daemonState: null,
    daemonStateVersion: 0,
  };
}

afterEach(() => {
  spawnedPtys.length = 0;
  delete process.env.HAPPIER_MACHINE_RPC_WORKING_DIRECTORY;
  delete process.env.HAPPIER_DAEMON_TERMINAL_ENABLED;
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('ApiMachineClient terminal handlers', () => {
    it('keeps terminal cwd validation on the startup filesystem policy snapshot', async () => {
    const suiteDir = mkdtempSync(join(tmpdir(), 'happier-api-machine-terminal-'));
    tempDirectories.push(suiteDir);
    const allowedRoot = join(suiteDir, 'allowed');
    const outsideRoot = join(suiteDir, 'outside');
    mkdirSync(allowedRoot, { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });

    process.env.HAPPIER_MACHINE_RPC_WORKING_DIRECTORY = allowedRoot;
    process.env.HAPPIER_DAEMON_TERMINAL_ENABLED = '1';
    const client = new ApiMachineClient('token', createMachine());

    delete process.env.HAPPIER_MACHINE_RPC_WORKING_DIRECTORY;
    client.setRPCHandlers({
      spawnSession: async () => ({ type: 'success', sessionId: 's1' }),
      stopSession: async () => true,
      requestShutdown: () => {},
    });

    const rpc = (client as unknown as { rpcHandlerManager: {
      invokeLocal: (method: string, params: unknown) => Promise<unknown>;
    } }).rpcHandlerManager;

    const response = await rpc.invokeLocal(RPC_METHODS.DAEMON_TERMINAL_ENSURE, {
      terminalKey: 'outside',
      cwd: outsideRoot,
      cols: 80,
      rows: 24,
    });

    expect(response).toEqual({
      ok: false,
      errorCode: 'terminal_cwd_denied',
      error: 'terminal_cwd_denied',
    });
    expect(spawnedPtys).toHaveLength(0);
  });

  it('uses the configured restricted root when machine terminal cwd is omitted', async () => {
    const suiteDir = mkdtempSync(join(tmpdir(), 'happier-api-machine-terminal-default-'));
    tempDirectories.push(suiteDir);
    const allowedRoot = join(suiteDir, 'allowed');
    mkdirSync(allowedRoot, { recursive: true });

    process.env.HAPPIER_MACHINE_RPC_WORKING_DIRECTORY = allowedRoot;
    process.env.HAPPIER_DAEMON_TERMINAL_ENABLED = '1';
    const client = new ApiMachineClient('token', createMachine());
    client.setRPCHandlers({
      spawnSession: async () => ({ type: 'success', sessionId: 's1' }),
      stopSession: async () => true,
      requestShutdown: () => {},
    });

    const rpc = (client as unknown as { rpcHandlerManager: {
      invokeLocal: (method: string, params: unknown) => Promise<unknown>;
    } }).rpcHandlerManager;

    const response = await rpc.invokeLocal(RPC_METHODS.DAEMON_TERMINAL_ENSURE, {
      terminalKey: 'restricted-default',
      cols: 80,
      rows: 24,
    });

    expect(response).toEqual(expect.objectContaining({ ok: true, reused: false }));
    expect(spawnedPtys).toHaveLength(1);
    expect(spawnedPtys[0]).toEqual(expect.objectContaining({
      options: expect.objectContaining({
        cwd: allowedRoot,
      }),
    }));
  });
});
