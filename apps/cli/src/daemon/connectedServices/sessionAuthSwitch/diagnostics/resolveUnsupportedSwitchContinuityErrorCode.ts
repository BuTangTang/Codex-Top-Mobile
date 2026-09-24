import type { SessionConnectedServiceAuthSwitchErrorCode } from '../switchSessionConnectedServiceAuth';

type UnsupportedSwitchContinuityErrorCode = Extract<
  SessionConnectedServiceAuthSwitchErrorCode,
  | 'provider_state_sharing_required'
  | 'provider_state_sharing_unavailable'
  | 'provider_state_sharing_settings_unavailable'
  | 'provider_session_state_unavailable_for_resume'
  | 'unsupported_service'
  | 'continuity_unsupported'
>;

const CONTINUITY_REASON_ERROR_CODES = new Set<UnsupportedSwitchContinuityErrorCode>([
  'provider_state_sharing_required',
  'provider_state_sharing_unavailable',
  'provider_state_sharing_settings_unavailable',
  'provider_session_state_unavailable_for_resume',
]);

function normalizeReason(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

export function resolveUnsupportedSwitchContinuityErrorCode(
  reason: unknown,
): UnsupportedSwitchContinuityErrorCode {
  const normalized = normalizeReason(reason);
  if (normalized === 'unsupported_service') return 'unsupported_service';
  if (
    normalized
    && CONTINUITY_REASON_ERROR_CODES.has(normalized as UnsupportedSwitchContinuityErrorCode)
  ) {
    return normalized as UnsupportedSwitchContinuityErrorCode;
  }
  return 'continuity_unsupported';
}
