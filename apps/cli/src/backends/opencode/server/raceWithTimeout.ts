export type RaceWithTimeoutResult<T> =
  | { type: 'resolved'; value: T }
  | { type: 'rejected'; error: unknown }
  | { type: 'timeout' };

export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<RaceWithTimeoutResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise
        .then((value) => ({ type: 'resolved' as const, value }))
        .catch((error) => ({ type: 'rejected' as const, error })),
      new Promise<{ type: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
