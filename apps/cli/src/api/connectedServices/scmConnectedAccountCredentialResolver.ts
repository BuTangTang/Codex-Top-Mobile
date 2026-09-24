import { AsyncTtlCache, type ConnectedServiceCredentialRecordV1, type ConnectedServiceId } from '@happier-dev/protocol';

import type { ApiClient } from '@/api/api';
import { resolveConnectedServiceCredentials } from '@/cloud/connectedServices/resolveConnectedServiceCredentials';
import type { Credentials } from '@/persistence';
import type { ScmConnectedAccountCredentialResolver } from '@/scm/types';
import { logger } from '@/ui/logger';

const DEFAULT_SCM_CONNECTED_ACCOUNT_CREDENTIAL_SUCCESS_TTL_MS = 10_000;
const DEFAULT_SCM_CONNECTED_ACCOUNT_CREDENTIAL_ERROR_TTL_MS = 1_000;

function selectUnambiguousConnectedProfileId(params: Readonly<{
  serviceId: ConnectedServiceId;
  profiles: Awaited<ReturnType<ApiClient['listConnectedServiceProfiles']>>['profiles'];
}>): string | null {
  const connectedProfiles = params.profiles.filter((entry) => entry.status === 'connected');
  const selectedProfileId = connectedProfiles[0]?.profileId ?? null;
  if (connectedProfiles.length > 1 && selectedProfileId) {
    logger.debug(
      `[API] [SCM] Multiple connected profiles are available for ${params.serviceId}; selecting ${selectedProfileId} from server-ordered results.`,
    );
  }

  return selectedProfileId;
}

export function createScmConnectedAccountCredentialResolver(params: Readonly<{
  credentials: Credentials;
  api: ApiClient;
  cacheOptions?: Readonly<{
    successTtlMs?: number;
    errorTtlMs?: number;
    nowMs?: () => number;
  }>;
}>): ScmConnectedAccountCredentialResolver {
  const nowMs = params.cacheOptions?.nowMs ?? Date.now;
  const cache = new AsyncTtlCache<ConnectedServiceCredentialRecordV1 | null>({
    successTtlMs: params.cacheOptions?.successTtlMs ?? DEFAULT_SCM_CONNECTED_ACCOUNT_CREDENTIAL_SUCCESS_TTL_MS,
    errorTtlMs: params.cacheOptions?.errorTtlMs ?? DEFAULT_SCM_CONNECTED_ACCOUNT_CREDENTIAL_ERROR_TTL_MS,
  });

  async function resolveCredentialFromServer(serviceId: ConnectedServiceId) {
    const profiles = await params.api.listConnectedServiceProfiles({ serviceId });
    const profileId = selectUnambiguousConnectedProfileId({
      serviceId,
      profiles: profiles.profiles,
    });
    if (!profileId) return null;
    const records = await resolveConnectedServiceCredentials({
      credentials: params.credentials,
      api: params.api,
      bindings: [{ serviceId, profileId }],
    });
    return records.get(serviceId) ?? null;
  }

  async function resolveCredential(serviceId: ConnectedServiceId) {
    const cached = cache.get(serviceId);
    const now = nowMs();
    if (cached && cache.isFresh(cached, now)) {
      return cached.kind === 'success' ? cached.value : null;
    }

    return await cache.runDedupe(serviceId, async () => {
      const cachedAfterDedupe = cache.get(serviceId);
      const dedupeNow = nowMs();
      if (cachedAfterDedupe && cache.isFresh(cachedAfterDedupe, dedupeNow)) {
        return cachedAfterDedupe.kind === 'success' ? cachedAfterDedupe.value : null;
      }

      try {
        const record = await resolveCredentialFromServer(serviceId);
        cache.setSuccess(serviceId, record, { nowMs: nowMs() });
        return record;
      } catch (error) {
        cache.setError(serviceId, { nowMs: nowMs() });
        logger.debug(`[API] [SCM] Failed to resolve connected account credential:`, error);
        return null;
      }
    });
  }

  return {
    resolveCredential,
  };
}
