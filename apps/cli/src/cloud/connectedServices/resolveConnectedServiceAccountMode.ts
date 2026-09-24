import { createConnectedServiceAccountModeCache } from './createConnectedServiceAccountModeCache';
import type {
  ConnectedServiceAccountMode,
  ConnectedServiceAccountModeApi,
} from './createConnectedServiceAccountModeCache';

export type { ConnectedServiceAccountMode } from './createConnectedServiceAccountModeCache';

const ACCOUNT_MODE_ERROR_BACKOFF_MS = 30_000;

const accountModeCache = createConnectedServiceAccountModeCache({
  errorTtlMs: ACCOUNT_MODE_ERROR_BACKOFF_MS,
});

export async function resolveConnectedServiceAccountMode(
  api: ConnectedServiceAccountModeApi,
  options?: Readonly<{ refresh?: boolean }>,
): Promise<ConnectedServiceAccountMode> {
  if (options?.refresh) return await accountModeCache.refresh(api);
  return await accountModeCache.resolve(api);
}

export function invalidateConnectedServiceAccountMode(
  api?: ConnectedServiceAccountModeApi,
): void {
  if (api) {
    accountModeCache.invalidate(api);
    return;
  }
  accountModeCache.clear();
}
