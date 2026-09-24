import {
  findCodexRolloutFileByIdSync,
  resolveCodexNativeSessionsRoot,
} from '@/backends/codex/utils/codexSessionFiles';

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readMetadataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export function resolveCodexConnectedServiceCandidatePersistedSessionFile(input: Readonly<{
  metadata: unknown;
  env?: NodeJS.ProcessEnv;
}>): string | null {
  const metadata = readMetadataRecord(input.metadata);
  if (!metadata) return null;
  if (metadata.codexBackendMode !== 'appServer') return null;
  const vendorResumeId = readNonEmptyString(metadata.codexSessionId);
  if (!vendorResumeId) return null;
  if (vendorResumeId.includes('/') || vendorResumeId.includes('\\')) return null;

  return findCodexRolloutFileByIdSync({
    sessionsRoot: resolveCodexNativeSessionsRoot(input.env ?? process.env),
    vendorResumeId,
  });
}
