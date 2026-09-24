import { afterEach, describe, expect, it } from 'vitest';

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY } from '@/daemon/connectedServices/connectedServiceChildEnvironment';

import { PiRpcBackend } from './PiRpcBackend';

/**
 * O2 — when the Pi vendor process exits non-zero, the surfaced status must carry STRUCTURED context
 * (exit code, signal, stderr tail, vendor resume id, cwd, materialization root, requested/effective
 * state mode) instead of a bare "Pi process exited". This is the residual failure-path observability
 * that pairs with the K1 §2 fail-closed gate: even when the gate passes but the vendor still dies,
 * the operator gets a concrete, debuggable signal rather than an opaque crash.
 */

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeFakePiRpcStderrThenExitScript(dir: string): string {
  const scriptPath = join(dir, 'fake-pi-rpc-stderr-then-exit.js');
  const script = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');

let started = false;
rl.on('line', (line) => {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    return;
  }

  switch (command.type) {
    case 'new_session':
      out({ id: command.id, type: 'response', command: 'new_session', success: true, data: { cancelled: false } });
      break;
    case 'get_state':
      out({
        id: command.id,
        type: 'response',
        command: 'get_state',
        success: true,
        data: {
          sessionId: 'pi-session-exit-context',
          model: { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o mini' }
        }
      });
      break;
    case 'get_available_models':
      out({
        id: command.id,
        type: 'response',
        command: 'get_available_models',
        success: true,
        data: { models: [{ id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o mini' }] }
      });
      break;
    case 'get_commands':
      out({ id: command.id, type: 'response', command: 'get_commands', success: true, data: { commands: [] } });
      if (!started) {
        started = true;
        process.stderr.write('pi: failed to load session: ENOENT\\n');
        setTimeout(() => process.exit(1), 10);
      }
      break;
    default:
      out({ id: command.id, type: 'response', command: command.type, success: true });
      break;
  }
});
`;
  writeFileSync(scriptPath, script, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe('PiRpcBackend process-exit context (O2)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces structured context (exit code, cwd, resume id, materialization root) when the Pi process exits non-zero', async () => {
    const workDir = makeTempDir('happier-pi-rpc-exit-context-');
    tempDirs.push(workDir);
    const fakeScript = makeFakePiRpcStderrThenExitScript(workDir);
    const agentDir = join(workDir, 'pi-agent-dir');
    const materializationRoot = join(workDir, 'materialized-root');

    const backend = new PiRpcBackend({
      cwd: workDir,
      command: process.execPath,
      args: [fakeScript],
      env: {
        PI_CODING_AGENT_DIR: agentDir,
        [HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]: materializationRoot,
      },
    });

    const errorDetails: string[] = [];
    backend.onMessage((message) => {
      const typed = message as { type?: string; status?: string; detail?: string };
      if (typed.type === 'status' && typed.status === 'error' && typeof typed.detail === 'string') {
        errorDetails.push(typed.detail);
      }
    });

    try {
      await backend.startSession();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for fake Pi process to exit')), 1000);
        const handler = (msg: unknown) => {
          const typed = msg as { type?: string; status?: string };
          if (typed?.type === 'status' && typed.status === 'error') {
            clearTimeout(timeout);
            backend.offMessage(handler);
            resolve();
          }
        };
        backend.onMessage(handler);
      });

      const exitDetail = errorDetails.find((detail) => detail.toLowerCase().includes('exited'));
      expect(exitDetail).toBeTruthy();
      // Structured, debuggable context — assert on the presence of the load-bearing fields, not exact copy.
      expect(exitDetail).toContain('code=1');
      expect(exitDetail).toContain(workDir);
      expect(exitDetail).toContain('pi-session-exit-context');
      expect(exitDetail).toContain(materializationRoot);
    } finally {
      await backend.dispose();
    }
  });
});
