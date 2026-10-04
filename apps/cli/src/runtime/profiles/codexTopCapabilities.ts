import type { DaemonMemoryCapability } from '@/daemon/memory/daemonMemoryCapability';
import type { SessionToolRegistrar } from '@/rpc/handlers/sessionToolCapabilities';
import type { CliProductCapabilities } from '@/runtime/productCapabilities';

/** 产品未携带本地 memory 实现，因此不创建 worker，也不注册对应 RPC。 */
export const daemonMemoryCapability: DaemonMemoryCapability | null = null;

/** Native 产品未暴露这些会话工具；缺省代表无注册，不能返回伪成功。 */
export const sessionToolRegistrars: readonly SessionToolRegistrar[] = Object.freeze([]);

/** 与上述真实注册组成一致；由构建别名选择，运行中不能用环境变量切换。 */
export const CLI_PRODUCT_CAPABILITIES: CliProductCapabilities = Object.freeze({
  id: 'codex-top',
  machineMemory: false,
  sessionTools: Object.freeze([]),
  unsupportedActionIds: Object.freeze([
    'memory.search', 'memory.get_window', 'memory.ensure_up_to_date',
  ] as const),
});
