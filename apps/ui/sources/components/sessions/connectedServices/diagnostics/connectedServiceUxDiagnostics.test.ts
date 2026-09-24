import { describe, expect, it } from 'vitest';

import {
    CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS,
    CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES,
    ConnectedServiceUxDiagnosticCodeV1Schema,
    type ConnectedServiceUxDiagnosticV1,
} from '@happier-dev/protocol';

import { resolveConnectedServiceUxDiagnosticPresentation } from './connectedServiceUxDiagnostics';

describe('resolveConnectedServiceUxDiagnosticPresentation', () => {
    it('maps the same resume-unreachable diagnostic to start-fresh presentation data', () => {
        const diagnostic: ConnectedServiceUxDiagnosticV1 = {
            code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.providerSessionStateUnavailableForResume,
            failurePhase: 'continuity',
            source: 'new_session',
            agentId: 'pi',
            retryable: false,
            suggestedActions: [
                CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.startFreshUnderSelectedAccount,
                CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.openConnectedAccounts,
            ],
            diagnostics: {
                reason: 'no_resumable_session_file',
            },
        };

        const presentation = resolveConnectedServiceUxDiagnosticPresentation(diagnostic);

        expect(presentation).toMatchObject({
            code: 'provider_session_state_unavailable_for_resume',
            statusKey: 'connectedServices.diagnostics.status.provider_session_state_unavailable_for_resume',
            titleKey: 'connectedServices.diagnostics.title.provider_session_state_unavailable_for_resume',
            actions: [
                expect.objectContaining({ kind: 'start_fresh_under_selected_account' }),
                expect.objectContaining({ kind: 'open_connected_accounts' }),
            ],
        });
        expect(presentation?.bodyParams).toMatchObject({
            reason: 'no_resumable_session_file',
            agentId: 'pi',
        });
    });

    it('uses one presentation mapping for switch verification failures', () => {
        const presentation = resolveConnectedServiceUxDiagnosticPresentation({
            code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.providerAccountAdoptionMismatch,
            failurePhase: 'post_switch_verification',
            source: 'manual_auth_switch',
            serviceId: 'openai-codex',
            providerId: 'codex',
            agentId: 'codex',
            retryable: true,
            suggestedActions: [
                CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry,
                CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.openConnectedAccounts,
            ],
        });

        expect(presentation).toMatchObject({
            code: 'provider_account_adoption_mismatch',
            statusKey: 'connectedServices.diagnostics.status.provider_account_adoption_mismatch',
            actions: [
                expect.objectContaining({ kind: 'retry' }),
                expect.objectContaining({ kind: 'open_connected_accounts' }),
            ],
        });
    });

    it('normalizes protocol-valid diagnostics that omit suggestedActions before presentation mapping', () => {
        const presentation = resolveConnectedServiceUxDiagnosticPresentation({
            code: CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryRetryScheduled,
            failurePhase: 'runtime_auth_recovery',
            source: 'runtime_auth_recovery',
            retryable: true,
        });

        expect(presentation).toMatchObject({
            code: 'recovery_retry_scheduled',
            actions: [],
        });
    });

    it('maps Claude native-auth reconnect diagnostics without using the generic verification copy', () => {
        const presentation = resolveConnectedServiceUxDiagnosticPresentation({
            code: 'claude_subscription_missing_claude_code_scope',
            failurePhase: 'materialization',
            source: 'usage_limit_recovery',
            serviceId: 'claude-subscription',
            providerId: 'claude',
            agentId: 'claude',
            profileId: 'claude-profile',
            retryable: false,
            suggestedActions: [
                CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.reconnectProfile,
                CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.openConnectedAccounts,
            ],
            diagnostics: {
                materializationReason: 'missing_scope',
            },
        });

        expect(presentation).toMatchObject({
            code: 'claude_subscription_missing_claude_code_scope',
            titleKey: 'connectedServices.diagnostics.title.claude_subscription_missing_claude_code_scope',
            bodyKey: 'connectedServices.diagnostics.body.claude_subscription_missing_claude_code_scope',
            statusKey: 'connectedServices.diagnostics.status.claude_subscription_missing_claude_code_scope',
            actions: [
                expect.objectContaining({ kind: 'reconnect_profile' }),
                expect.objectContaining({ kind: 'open_connected_accounts' }),
            ],
        });
    });

    it.each(ConnectedServiceUxDiagnosticCodeV1Schema.options)('maps %s without falling back to another diagnostic code', (code) => {
        const diagnostic: ConnectedServiceUxDiagnosticV1 = {
            code,
            failurePhase: code === CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryRetryScheduled
                || code === CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryDeadLettered
                ? 'runtime_auth_recovery'
                : code === CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.providerAccountAdoptionMismatch
                    || code === CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.postSwitchVerificationFailed
                    ? 'post_switch_verification'
                    : code === CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.metadataUpdateFailed
                        ? 'metadata'
                        : code === CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.connectedServiceMaterializationIdentityMissing
                            ? 'materialization'
                            : 'continuity',
            source: 'manual_auth_switch',
            agentId: 'codex',
            retryable: code === CONNECTED_SERVICE_UX_DIAGNOSTIC_CODES.recoveryRetryScheduled,
            suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry],
            diagnostics: {
                reason: 'test_reason',
            },
        };

        const presentation = resolveConnectedServiceUxDiagnosticPresentation(diagnostic);

        expect(presentation).not.toBeNull();
        expect(presentation?.code).toBe(code);
        expect(presentation?.titleKey).toBe(`connectedServices.diagnostics.title.${code}`);
        expect(presentation?.bodyKey).toBe(`connectedServices.diagnostics.body.${code}`);
        expect(presentation?.statusKey).toBe(`connectedServices.diagnostics.status.${code}`);
    });

    it.each([
        'runtime_auth_recovery_superseded',
        'runtime_auth_generation_stale',
        'hot_apply_unavailable',
        'app_server_unavailable',
        'provider_account_identity_unverified',
        'quota_snapshot_stale',
        'quota_fetch_disabled',
        'quota_fetch_backoff',
        'auth_surface_weakly_verified',
    ] as const)('maps new recovery diagnostic %s through the central presentation resolver', (code) => {
        const presentation = resolveConnectedServiceUxDiagnosticPresentation({
            code,
            failurePhase: code === 'hot_apply_unavailable'
                ? 'hot_apply'
                : code === 'app_server_unavailable' || code === 'provider_account_identity_unverified' || code === 'auth_surface_weakly_verified'
                    ? 'post_switch_verification'
                    : 'runtime_auth_recovery',
            source: code === 'hot_apply_unavailable'
                ? 'manual_auth_switch'
                : code === 'app_server_unavailable'
                    ? 'transcript_switch_attempt'
                    : 'runtime_auth_recovery',
            agentId: 'codex',
            retryable: code !== 'auth_surface_weakly_verified',
            suggestedActions: [CONNECTED_SERVICE_UX_DIAGNOSTIC_ACTIONS.retry],
            diagnostics: {
                reason: code,
            },
        });

        expect(presentation).toMatchObject({
            code,
            titleKey: `connectedServices.diagnostics.title.${code}`,
            bodyKey: `connectedServices.diagnostics.body.${code}`,
            statusKey: `connectedServices.diagnostics.status.${code}`,
            actions: [expect.objectContaining({ kind: 'retry' })],
        });
    });
});
