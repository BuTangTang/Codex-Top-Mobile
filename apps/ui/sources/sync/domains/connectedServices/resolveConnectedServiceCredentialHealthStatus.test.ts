import { describe, expect, it } from 'vitest';

import { resolveConnectedServiceCredentialHealthStatus } from './resolveConnectedServiceCredentialHealthStatus';

describe('resolveConnectedServiceCredentialHealthStatus', () => {
    it('passes through the known health statuses verbatim', () => {
        expect(resolveConnectedServiceCredentialHealthStatus('connected')).toBe('connected');
        expect(resolveConnectedServiceCredentialHealthStatus('refreshing')).toBe('refreshing');
        expect(resolveConnectedServiceCredentialHealthStatus('refresh_failed_retryable')).toBe(
            'refresh_failed_retryable',
        );
        expect(resolveConnectedServiceCredentialHealthStatus('needs_reauth')).toBe('needs_reauth');
    });

    it('falls back to needs_reauth for unknown, missing, or non-string inputs', () => {
        expect(resolveConnectedServiceCredentialHealthStatus('disconnected')).toBe('needs_reauth');
        expect(resolveConnectedServiceCredentialHealthStatus('')).toBe('needs_reauth');
        expect(resolveConnectedServiceCredentialHealthStatus(undefined)).toBe('needs_reauth');
        expect(resolveConnectedServiceCredentialHealthStatus(null)).toBe('needs_reauth');
        expect(resolveConnectedServiceCredentialHealthStatus(42)).toBe('needs_reauth');
        expect(resolveConnectedServiceCredentialHealthStatus({ status: 'connected' })).toBe('needs_reauth');
    });
});
