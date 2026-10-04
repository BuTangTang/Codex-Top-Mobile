import type { DirectSessionsProviderId } from '@happier-dev/protocol';
import type { AgentCatalogEntry } from '../types';
import type { DirectSessionProviderOps } from './providerOps';
import { getOrLoadCatalogHookPromise } from '../catalogHookPromiseCache';

/** 每个注册入口只创建一次；逐调用读取当前条目，缓存不跨入口共享。 */
export function createDirectSessionProviderOpsResolver(
  getEntry: (providerId: DirectSessionsProviderId) => Pick<AgentCatalogEntry, 'getDirectSessionProviderOps'> | undefined,
): (providerId: DirectSessionsProviderId) => Promise<DirectSessionProviderOps> {
  const cachedDirectSessionProviderOpsPromises = new Map<DirectSessionsProviderId, Promise<DirectSessionProviderOps>>();

  // 不增加异步调度；公开 async 包装继续在同一个 await 处接收原 promise 或同步异常。
  return function resolveDirectSessionProviderOps(providerId: DirectSessionsProviderId): Promise<DirectSessionProviderOps> {
    const entry = getEntry(providerId);
    if (!entry?.getDirectSessionProviderOps) {
      throw new Error(`Missing direct-session provider ops for ${providerId}`);
    }

    return getOrLoadCatalogHookPromise(
      cachedDirectSessionProviderOpsPromises,
      providerId,
      entry.getDirectSessionProviderOps,
    );
  };
}
