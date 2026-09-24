import {
  getProviderCliRuntimeSpec,
  resolveAgentIdFromSessionMetadata,
} from '@happier-dev/agents';

function normalizeNotificationText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function readMetadataSnapshot(getMetadataSnapshot?: (() => unknown) | null): unknown {
  if (!getMetadataSnapshot) return null;
  try {
    return getMetadataSnapshot();
  } catch {
    return null;
  }
}

export function getSessionNotificationTitle(getMetadataSnapshot?: (() => unknown) | null): string | null {
  const metadata = readMetadataSnapshot(getMetadataSnapshot);
  const summaryText = normalizeNotificationText((metadata as { summary?: { text?: unknown } } | null)?.summary?.text);
  if (summaryText) return summaryText;
  const nameText = normalizeNotificationText((metadata as { name?: unknown } | null)?.name);
  if (nameText) return nameText;
  return normalizeNotificationText((metadata as { title?: unknown } | null)?.title);
}

export function getSessionNotificationAgentDisplayName(getMetadataSnapshot?: (() => unknown) | null): string | null {
  const metadata = readMetadataSnapshot(getMetadataSnapshot);
  const agentId = resolveAgentIdFromSessionMetadata(metadata);
  if (agentId) {
    return normalizeNotificationText(getProviderCliRuntimeSpec(agentId).title);
  }

  const configuredAcpTitle = normalizeNotificationText(
    (metadata as { acpConfiguredBackendV1?: { title?: unknown } } | null)?.acpConfiguredBackendV1?.title,
  );
  if (configuredAcpTitle) return configuredAcpTitle;

  const acpProvider = normalizeNotificationText(
    (metadata as { acpTransportV1?: { provider?: unknown } } | null)?.acpTransportV1?.provider,
  );
  if (acpProvider) return acpProvider;

  return null;
}
