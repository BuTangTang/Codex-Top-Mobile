export function connectedServiceProfileKey(params: Readonly<{ serviceId: string; profileId: string }>): string {
  const serviceId = encodeURIComponent(String(params.serviceId).trim());
  const profileId = encodeURIComponent(String(params.profileId).trim());
  return `${serviceId}/${profileId}`;
}

function connectedServiceProfileLegacyKey(params: Readonly<{ serviceId: string; profileId: string }>): string {
  return `${String(params.serviceId).trim()}/${String(params.profileId).trim()}`;
}

export function pruneConnectedServiceProfilePreferencesForDeletedProfile(params: Readonly<{
  serviceId: string;
  profileId: string;
  connectedServicesDefaultProfileByServiceId: Readonly<Record<string, string | undefined>>;
  connectedServicesProfileLabelByKey: Readonly<Record<string, string | undefined>>;
}>): {
  connectedServicesDefaultProfileByServiceId: Record<string, string>;
  connectedServicesProfileLabelByKey: Record<string, string>;
} {
  const serviceId = String(params.serviceId).trim();
  const profileId = String(params.profileId).trim();
  const encodedKey = connectedServiceProfileKey({ serviceId, profileId });
  const legacyKey = connectedServiceProfileLegacyKey({ serviceId, profileId });

  const connectedServicesDefaultProfileByServiceId = copyDefinedStringRecord(
    params.connectedServicesDefaultProfileByServiceId,
  );
  if (connectedServicesDefaultProfileByServiceId[serviceId] === profileId) {
    delete connectedServicesDefaultProfileByServiceId[serviceId];
  }

  const connectedServicesProfileLabelByKey = copyDefinedStringRecord(params.connectedServicesProfileLabelByKey);
  delete connectedServicesProfileLabelByKey[encodedKey];
  delete connectedServicesProfileLabelByKey[legacyKey];

  return {
    connectedServicesDefaultProfileByServiceId,
    connectedServicesProfileLabelByKey,
  };
}

function copyDefinedStringRecord(input: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

export function resolveConnectedServiceProfileLabel(params: Readonly<{
  labelsByKey: Readonly<Record<string, string | undefined>>;
  serviceId: string;
  profileId: string;
}>): string | null {
  const key = connectedServiceProfileKey({ serviceId: params.serviceId, profileId: params.profileId });
  const raw = params.labelsByKey[key]
    ?? params.labelsByKey[connectedServiceProfileLegacyKey({ serviceId: params.serviceId, profileId: params.profileId })];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function resolveConnectedServiceDefaultProfileId(params: Readonly<{
  serviceId: string;
  connectedProfileIds: ReadonlyArray<string>;
  defaultProfileByServiceId: Readonly<Record<string, string | undefined>>;
}>): string | null {
  const fallback = params.connectedProfileIds[0] ?? null;
  if (!fallback) return null;
  const preferredRaw = params.defaultProfileByServiceId[String(params.serviceId).trim()];
  const preferred = typeof preferredRaw === 'string' ? preferredRaw.trim() : '';
  if (!preferred) return fallback;
  return params.connectedProfileIds.includes(preferred) ? preferred : fallback;
}
