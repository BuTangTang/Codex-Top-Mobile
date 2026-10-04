import { registerMachineMemoryRpcHandlers } from '@/api/machine/rpcHandlers.memory';
import { startMemoryWorker } from './memoryWorker';

export type DaemonMemoryCapability = Readonly<{
  start: typeof startMemoryWorker;
  registerRpcHandlers: typeof registerMachineMemoryRpcHandlers;
}>;

/** 默认 CLI 复用原 worker 与 RPC owner；产品构建可显式不提供该能力。 */
export const daemonMemoryCapability: DaemonMemoryCapability | null = Object.freeze({
  start: startMemoryWorker,
  registerRpcHandlers: registerMachineMemoryRpcHandlers,
});
