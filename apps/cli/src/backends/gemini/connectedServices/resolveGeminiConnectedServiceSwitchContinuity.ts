import { AGENTS_CORE } from '@happier-dev/agents';

import type {
  ConnectedServiceSwitchContinuityParams,
  ConnectedServiceSwitchContinuityResult,
} from '@/backends/types';
import {
  hasExactConnectedServiceRestartContinuityContext,
  isConnectedToConnectedServiceSwitch,
  isExactSameConnectedServiceSelection,
  providerSessionStateUnavailableForResume,
} from '@/backends/connectedServices/switchContinuityContext';
import { canResumeFromMaterializedStateCore } from '@/daemon/connectedServices/stateSharing/canResumeFromMaterializedStateCore';
import { resolveConnectedServiceRestartContinuityAction } from '@/daemon/connectedServices/sessionAuthSwitch/continuity/resolveConnectedServiceSwitchAction';
import { geminiConnectedServiceStateSharingDescriptor } from './geminiConnectedServiceStateSharingDescriptor';
import { verifyResumeReachableGemini } from './verifyResumeReachableGemini';

const GEMINI_RESTART_REMATERIALIZE_REQUIRED_REASON = 'gemini_restart_rematerialize_required';

function supportsService(serviceId: string): boolean {
  return (AGENTS_CORE.gemini.connectedServices.supportedServiceIds as readonly string[]).includes(serviceId);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveGeminiConnectedServiceSwitchContinuity(
  params: ConnectedServiceSwitchContinuityParams,
): Promise<ConnectedServiceSwitchContinuityResult> {
  if (!supportsService(params.serviceId)) {
    return { mode: 'unsupported', reason: 'unsupported_service' };
  }
  if (isConnectedToConnectedServiceSwitch(params)) {
    if (!isExactSameConnectedServiceSelection(params)) {
      return resolveConnectedServiceRestartContinuityAction({
        stateSharingDescriptor: geminiConnectedServiceStateSharingDescriptor,
        restartReason: GEMINI_RESTART_REMATERIALIZE_REQUIRED_REASON,
      });
    }
    if (!hasExactConnectedServiceRestartContinuityContext(params)) {
      return providerSessionStateUnavailableForResume();
    }

    const targetMaterializedRoot = asNonEmptyString(params.targetMaterializedRoot);
    const vendorResumeId = asNonEmptyString(params.vendorResumeId);
    const cwd = asNonEmptyString(params.cwd);
    const materializationIdentity = params.connectedServiceMaterializationIdentityV1 ?? null;
    const targetMaterializedEnv = params.targetMaterializedEnv ?? null;
    if (
      !targetMaterializedRoot
      || !vendorResumeId
      || !cwd
      || !materializationIdentity
      || !targetMaterializedEnv
    ) {
      return providerSessionStateUnavailableForResume();
    }

    const reachability = await canResumeFromMaterializedStateCore({
      targetMaterializedRoot,
      targetMaterializedEnv,
      requestedStateMode: 'isolated',
      effectiveStateMode: 'isolated',
      materializationIdentity,
      vendorResumeId,
      cwd,
      candidatePersistedSessionFile: params.candidatePersistedSessionFile ?? null,
      verifyResumeReachable: verifyResumeReachableGemini,
    });
    return reachability.ok
      ? { mode: 'restart_same_home' }
      : providerSessionStateUnavailableForResume({
          diagnostics: reachability.continuityDiagnostics,
        });
  }
  return resolveConnectedServiceRestartContinuityAction({
    stateSharingDescriptor: geminiConnectedServiceStateSharingDescriptor,
    restartReason: GEMINI_RESTART_REMATERIALIZE_REQUIRED_REASON,
  });
}
