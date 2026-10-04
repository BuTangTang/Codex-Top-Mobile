/** 复用同次加载和成功结果；失败只淘汰自身，调用时同步启动原 loader。 */
export function getOrLoadCatalogHookPromise<TKey, TValue>(
  cache: Map<TKey, Promise<TValue>>,
  key: TKey,
  load: () => Promise<TValue>,
): Promise<TValue> {
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = load();
  cache.set(key, promise);
  void promise.catch(() => {
    if (cache.get(key) === promise) {
      cache.delete(key);
    }
  });
  return promise;
}
