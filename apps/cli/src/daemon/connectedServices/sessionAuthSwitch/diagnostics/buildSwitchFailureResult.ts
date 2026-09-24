import {
  CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES,
  type ConnectedServiceUxDiagnosticV1,
} from '@happier-dev/protocol';

import type { ConnectedServiceResumeContinuityDiagnostics } from '@/backends/types';

import { buildConnectedServiceUxDiagnostic } from '../../diagnostics/connectedServiceUxDiagnostics';
import { sanitizeConnectedServiceDiagnosticString } from '../../diagnostics/sanitizeConnectedServiceDiagnosticString';
import { isConnectedServiceRestartSignalStaleProcessError } from '../requestConnectedServiceSessionRestartSignal';
import type {
  SessionConnectedServiceAuthSwitchDiagnostics,
  SessionConnectedServiceAuthSwitchErrorCode,
  SessionConnectedServiceAuthSwitchResult,
  SessionConnectedServiceSwitchContinuity,
} from '../switchSessionConnectedServiceAuth';

type SessionConnectedServiceAuthSwitchFailure = Extract<
  SessionConnectedServiceAuthSwitchResult,
  Readonly<{ ok: false }>
>;

/**
 * Sanitized one-line summary of an apply error for the failure diagnostic. Captures the error name,
 * a numeric/string RPC `code` if present, and a length-bounded provider response message.
 */
export function summarizeConnectedServiceSwitchApplyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return sanitizeConnectedServiceSwitchUnderlyingError(String(error), 300);
  }
  const code = (error as { code?: unknown }).code;
  const codePart = typeof code === 'number' || typeof code === 'string' ? ` (code=${String(code)})` : '';
  return sanitizeConnectedServiceSwitchUnderlyingError(`${error.name}${codePart}: ${error.message}`, 400);
}

export function sanitizeConnectedServiceSwitchUnderlyingError(value: string, maxLength = 400): string {
  return sanitizeConnectedServiceDiagnosticString(value, { maxLength });
}

export function buildRestartFailureOptions(
  error: unknown,
  extra: Readonly<{
    partialState?: NonNullable<SessionConnectedServiceAuthSwitchDiagnostics['partialState']>;
  }> = {},
): Readonly<{
  failurePhase: 'restart';
  partialState?: NonNullable<SessionConnectedServiceAuthSwitchDiagnostics['partialState']>;
  underlyingError: string;
  retryable?: true;
}> {
  return {
    failurePhase: 'restart',
    ...(extra.partialState ? { partialState: extra.partialState } : {}),
    underlyingError: summarizeConnectedServiceSwitchApplyError(error),
    ...(isConnectedServiceRestartSignalStaleProcessError(error) ? { retryable: true } : {}),
  };
}

function resolveSwitchUxDiagnosticCode(
  errorCode: SessionConnectedServiceAuthSwitchErrorCode,
): ConnectedServiceUxDiagnosticV1['code'] | null {
  switch (errorCode) {
    case 'provider_session_state_unavailable_for_resume':
      return CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.providerSessionStateUnavailableForResume;
    case 'metadata_update_failed':
      return CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.metadataUpdateFailed;
    case 'provider_account_adoption_mismatch':
      return CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.providerAccountAdoptionMismatch;
    case 'post_switch_verification_failed':
      return CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.postSwitchVerificationFailed;
    default:
      return null;
  }
}

export function buildSwitchFailureResult(
  errorCode: SessionConnectedServiceAuthSwitchErrorCode,
  options: Readonly<{
    serviceId?: string;
    continuityByServiceId?: Readonly<Record<string, SessionConnectedServiceSwitchContinuity['mode']>>;
    failurePhase?: NonNullable<SessionConnectedServiceAuthSwitchDiagnostics['failurePhase']>;
    attemptedAction?: NonNullable<SessionConnectedServiceAuthSwitchDiagnostics['attemptedAction']>;
    partialState?: NonNullable<SessionConnectedServiceAuthSwitchDiagnostics['partialState']>;
    serviceResultsByServiceId?: NonNullable<SessionConnectedServiceAuthSwitchDiagnostics['serviceResultsByServiceId']>;
    actionRequired?: NonNullable<SessionConnectedServiceAuthSwitchDiagnostics['actionRequired']>;
    underlyingError?: string;
    retryable?: boolean;
    verification?: NonNullable<SessionConnectedServiceAuthSwitchDiagnostics['verification']>;
    continuity?: ConnectedServiceResumeContinuityDiagnostics;
    uxDiagnostic?: ConnectedServiceUxDiagnosticV1;
    diagnosticSource: ConnectedServiceUxDiagnosticV1['source'];
  }>,
): SessionConnectedServiceAuthSwitchFailure {
  const sanitizedUnderlyingError = options.underlyingError
    ? sanitizeConnectedServiceSwitchUnderlyingError(options.underlyingError)
    : undefined;
  const sanitizedVerification = options.verification
    ? {
        ...options.verification,
        ...(options.verification.reason
          ? { reason: sanitizeConnectedServiceDiagnosticString(options.verification.reason) }
          : {}),
      }
    : undefined;
  const safeContinuity = options.continuity
    ? {
        requestedStateMode: options.continuity.requestedStateMode,
        effectiveStateMode: options.continuity.effectiveStateMode,
        reachabilityMissReason: sanitizeConnectedServiceDiagnosticString(options.continuity.reachabilityMissReason),
      }
    : undefined;
  const uxDiagnosticSafeDetails = {
    ...(options.partialState ? { partialState: options.partialState } : {}),
    ...(sanitizedVerification?.reason ? { reason: sanitizedVerification.reason } : {}),
    ...(options.actionRequired?.kind ? { actionRequired: options.actionRequired.kind } : {}),
    ...(safeContinuity?.reachabilityMissReason ? { reason: safeContinuity.reachabilityMissReason } : {}),
  };
  const diagnostics = options.failurePhase || options.partialState || options.serviceResultsByServiceId || options.actionRequired || sanitizedUnderlyingError || options.retryable !== undefined || sanitizedVerification || options.continuity || options.uxDiagnostic
    || resolveSwitchUxDiagnosticCode(errorCode)
    ? {
        ...(options.failurePhase ? { failurePhase: options.failurePhase } : {}),
        ...(options.attemptedAction ? { attemptedAction: options.attemptedAction } : {}),
        ...(options.partialState ? { partialState: options.partialState } : {}),
        ...(options.serviceResultsByServiceId ? { serviceResultsByServiceId: options.serviceResultsByServiceId } : {}),
        ...(options.actionRequired ? { actionRequired: options.actionRequired } : {}),
        ...(sanitizedUnderlyingError ? { underlyingError: sanitizedUnderlyingError } : {}),
        ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
        ...(sanitizedVerification ? { verification: sanitizedVerification } : {}),
        ...(safeContinuity ? { continuity: safeContinuity } : {}),
        ...(options.uxDiagnostic
          ? { uxDiagnostic: options.uxDiagnostic }
          : resolveSwitchUxDiagnosticCode(errorCode) && options.failurePhase
          ? {
              uxDiagnostic: buildConnectedServiceUxDiagnostic({
                code: resolveSwitchUxDiagnosticCode(errorCode)!,
                failurePhase: options.failurePhase,
                source: options.diagnosticSource,
                ...(options.serviceId ? { serviceId: options.serviceId } : {}),
                retryable: options.retryable === true,
                ...(Object.keys(uxDiagnosticSafeDetails).length > 0
                  ? { diagnostics: uxDiagnosticSafeDetails }
                  : {}),
              }),
            }
          : {}),
      }
    : undefined;
  return {
    ok: false,
    errorCode,
    ...(options.serviceId ? { serviceId: options.serviceId } : {}),
    ...(options.continuityByServiceId ? { continuityByServiceId: options.continuityByServiceId } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
}
