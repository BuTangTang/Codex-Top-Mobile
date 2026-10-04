import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cliRoot = fileURLToPath(new URL('../../', import.meta.url));
type Fixture = {
  inspect(): { tools: string[]; retainedMachine: boolean[]; retainedSession: boolean[]; memoryAvailable: boolean; advertisedMemory: boolean };
  spawn(raw: unknown): Promise<unknown>;
  spawned(): number;
  transferAttachment(): Promise<{ content: string; sizeBytes: number }>;
  dispose(): Promise<void>;
};

/** 使用真实注册器与管理器；仅把最终启动进程的回调替换为内存接收端。 */
async function loadFixture(product: boolean): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'happier-product-registration-'));
  vi.stubEnv('HAPPIER_HOME_DIR', directory);
  vi.stubEnv('HOME', directory);
  const descriptor = `${cliRoot}src/runtime/profiles/codexTopCapabilities.ts`;
  try {
    await symlink(join(cliRoot, '../../node_modules'), join(directory, 'node_modules'), 'dir');
    const result = await build({
      absWorkingDir: cliRoot,
      stdin: {
        contents: `
          import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
          import { registerMachineRpcHandlers } from '@/api/machine/rpcHandlers';
          import { registerSessionHandlers } from '@/rpc/handlers/registerSessionHandlers';
          import { daemonMemoryCapability } from '@/daemon/memory/daemonMemoryCapability';
          import { CLI_PRODUCT_CAPABILITIES } from '@/runtime/productCapabilities';
          import { RPC_METHODS } from '@happier-dev/protocol/rpc';
          import { createEncryptedTransferChunkEnvelope } from '@/machines/transfer/transferChunkEncryption';
          import { readFile } from 'node:fs/promises';
          import { join } from 'node:path';
          export function create(workspace) {
            const machine = new RpcHandlerManager({scopePrefix:'fixture-machine', encryptionKey:new Uint8Array(32), encryptionVariant:'legacy'});
            const session = new RpcHandlerManager({scopePrefix:'fixture-session', encryptionKey:new Uint8Array(32), encryptionVariant:'legacy'});
            let spawnCount = 0;
            const registration = registerMachineRpcHandlers({rpcHandlerManager:machine,handlers:{
              spawnSession:async()=>{spawnCount++;return {type:'success',sessionId:'synthetic-session'}},
              stopSession:async()=>({status:'stopped'}),requestShutdown:()=>{},
            },deps:{machineRpcWorkingDirectory:workspace,promptAssetsHomedir:()=>workspace,promptAssetsHappierHomeDir:()=>workspace}});
            const sessionRegistration = registerSessionHandlers(session, workspace);
            return {
              inspect:()=>({
                tools:[RPC_METHODS.RIPGREP,RPC_METHODS.DIFFTASTIC].filter(method=>session.hasHandler(method)),
                retainedMachine:[RPC_METHODS.STOP_SESSION,RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER,RPC_METHODS.DAEMON_DIRECT_SESSION_TAKEOVER_PERSIST,RPC_METHODS.DAEMON_DIRECT_SESSION_SEND,RPC_METHODS.DAEMON_DIRECT_SESSION_FOLLOW_POLICY_SET].map(method=>machine.hasHandler(method)),
                retainedSession:[RPC_METHODS.DAEMON_BULK_TRANSFER_UPLOAD_INIT,RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT].map(method=>session.hasHandler(method)),
                memoryAvailable:daemonMemoryCapability!==null,
                advertisedMemory:CLI_PRODUCT_CAPABILITIES.machineMemory,
              }),
              spawn:raw=>machine.invokeLocal(RPC_METHODS.SPAWN_HAPPY_SESSION_PROVIDER_SAFE, {directory:workspace,...raw}),
              spawned:()=>spawnCount,
              transferAttachment:async()=>{
                const payload = Buffer.from('fixture');
                const init = await session.invokeLocal(RPC_METHODS.DAEMON_BULK_TRANSFER_UPLOAD_INIT, {
                  t:'session_attachment_upload_v1',messageLocalId:'fixture-message',fileName:'fixture.txt',sizeBytes:payload.length,
                  uploadLocation:'workspace',workspaceRelativeDir:'.happier/uploads',vcsIgnoreStrategy:'none',vcsIgnoreWritesEnabled:false,
                });
                if(!init.success) throw new Error('Fixture attachment init failed');
                const encrypted = createEncryptedTransferChunkEnvelope({transferId:init.uploadId,sequence:0,payload,recipientPublicKeyBase64:init.recipientPublicKeyBase64});
                const chunk = await session.invokeLocal(RPC_METHODS.DAEMON_BULK_TRANSFER_UPLOAD_CHUNK, {
                  uploadId:init.uploadId,index:0,payloadBase64:encrypted.payloadBase64,encryptedDataKeyEnvelopeBase64:encrypted.encryptedDataKeyEnvelopeBase64,
                });
                if(!chunk.success) throw new Error('Fixture attachment chunk failed');
                const final = await session.invokeLocal(RPC_METHODS.DAEMON_BULK_TRANSFER_UPLOAD_FINALIZE, {uploadId:init.uploadId});
                if(!final.success) throw new Error('Fixture attachment finalize failed');
                return {content:await readFile(join(workspace,final.path),'utf8'),sizeBytes:final.sizeBytes};
              },
              dispose:async()=>{await registration.dispose();await sessionRegistration.dispose();machine.clearHandlers();session.clearHandlers()},
            };
          }`,
        resolveDir: `${cliRoot}src`, loader: 'ts',
      },
      bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external',
      alias: {
        ...(product ? {
          '@/backends/catalogRegistry': `${cliRoot}src/backends/catalogRegistry.codexTop.ts`,
          '@/daemon/memory/daemonMemoryCapability': descriptor,
          '@/rpc/handlers/sessionToolCapabilities': descriptor,
          '@/runtime/productCapabilities': descriptor,
        } : {}), '@': `${cliRoot}src`,
      }, logLevel: 'silent',
    });
    const entry = join(directory, 'registration.mjs');
    await writeFile(entry, result.outputFiles[0]!.contents);
    const module = await import(pathToFileURL(entry).href);
    vi.useFakeTimers();
    const fixture: Fixture = module.create(directory);
    return { ...fixture, dispose: async () => {
      await fixture.dispose();
      vi.clearAllTimers();
      vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    } };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('product runtime capability composition', () => {
  it.each([false, true])('registers only available optional capabilities for product=%s', async (product) => {
    const fixture = await loadFixture(product);
    try {
      const actual = fixture.inspect();
      expect(actual.tools).toEqual(product ? [] : ['ripgrep', 'difftastic']);
      expect(actual.retainedMachine).toEqual([true, true, true, true, true]);
      expect(actual.retainedSession).toEqual([true, true]);
      expect(actual.memoryAvailable).toBe(!product);
      expect(actual.advertisedMemory).toBe(!product);
      expect(await fixture.transferAttachment()).toEqual({content:'fixture',sizeBytes:7});
    } finally { await fixture.dispose(); }
  });

  it('rejects raw unsupported product targets before reaching the process boundary', async () => {
    const fixture = await loadFixture(true);
    try {
      for (const request of [
        { backendTarget: { kind: 'configuredAcpBackend', backendId: 'fixture-backend' } },
        { backendTarget: { kind: 'builtInAgent', agentId: 'claude' } },
        { backendTarget: { kind: 'unknown', agentId: 'codex' } },
        { backendTarget: 'codex' },
        { agent: 'claude', backendTarget: { kind: 'builtInAgent', agentId: 'codex' } },
      ]) {
        expect(await fixture.spawn(request)).toMatchObject({type:'error', errorCode:'INVALID_REQUEST'});
      }
      expect(fixture.spawned()).toBe(0);
      expect(await fixture.spawn({ backendTarget: { kind: 'builtInAgent', agentId: 'codex' } })).toMatchObject({type:'success'});
      expect(fixture.spawned()).toBe(1);
      expect(await fixture.spawn({})).toMatchObject({type:'success'});
      expect(fixture.spawned()).toBe(2);
    } finally { await fixture.dispose(); }
  });
});
