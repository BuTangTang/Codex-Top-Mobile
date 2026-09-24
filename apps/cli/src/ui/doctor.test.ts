import { describe, it, expect } from 'vitest';
import {
    formatDaemonOwnerLabel,
    hasDaemonOwnerMismatchForCurrentInvocation,
    maskValue,
    redactDaemonStateForDisplay,
    shouldShowGlobalProcessInventory,
} from './doctor';

describe('doctor redaction', () => {
    it('does not treat ${VAR:-default} templates as safe', () => {
        expect(maskValue('${SAFE_TEMPLATE}')).toBe('${SAFE_TEMPLATE}');
        expect(maskValue('${LEAK:-sk-live-secret}')).toMatch(/^\$\{LEAK:-<\d+ chars>\}$/);
        expect(maskValue('${LEAK:=sk-live-secret}')).toMatch(/^\$\{LEAK:=<\d+ chars>\}$/);
        expect(maskValue('${LEAK:-}')).toBe('${LEAK:-}');
    });

    it('handles empty, undefined, and plain secret values', () => {
        expect(maskValue('')).toBe('<empty>');
        expect(maskValue(undefined)).toBeUndefined();
        expect(maskValue('sk-live-secret')).toBe('<14 chars>');
    });

    it('redacts daemon control tokens from daemon state', () => {
        const redacted = redactDaemonStateForDisplay({
            pid: 123,
            httpPort: 456,
            startedAt: 1,
            startedWithCliVersion: '0.0.0',
            controlToken: 'secret-token',
        });
        expect(redacted).toEqual({
            pid: 123,
            httpPort: 456,
            startedAt: 1,
            startedWithCliVersion: '0.0.0',
            controlToken: '<redacted>',
        });
    });

    it('keeps daemon state unchanged when control token is missing or blank', () => {
        expect(redactDaemonStateForDisplay({
            pid: 123,
            httpPort: 456,
            startedAt: 1,
            startedWithCliVersion: '0.0.0',
        })).toMatchObject({
            pid: 123,
            httpPort: 456,
            startedAt: 1,
            startedWithCliVersion: '0.0.0',
        });

        expect(redactDaemonStateForDisplay({
            pid: 123,
            httpPort: 456,
            startedAt: 1,
            startedWithCliVersion: '0.0.0',
            controlToken: '',
        })).toMatchObject({
            controlToken: '',
        });
    });
});

describe('doctor process inventory visibility', () => {
    it('hides global process inventory for daemon-only status output', () => {
        expect(shouldShowGlobalProcessInventory('daemon')).toBe(false);
    });

    it('shows global process inventory for full doctor output', () => {
        expect(shouldShowGlobalProcessInventory('all')).toBe(true);
    });
});

describe('doctor daemon owner formatting', () => {
    it('formats background-service owner details', () => {
        expect(formatDaemonOwnerLabel({
            startedWithPublicReleaseChannel: 'preview',
            startedWithCliVersion: '1.2.3',
            serviceManaged: true,
            serviceLabel: 'com.happier.cli.daemon.default',
        })).toContain('background service');
        expect(formatDaemonOwnerLabel({
            startedWithPublicReleaseChannel: 'preview',
            startedWithCliVersion: '1.2.3',
            serviceManaged: true,
            serviceLabel: 'com.happier.cli.daemon.default',
        })).toContain('com.happier.cli.daemon.default');
    });

    it('keeps legacy owner wording neutral when startup metadata is missing', () => {
        expect(formatDaemonOwnerLabel({
            startedWithPublicReleaseChannel: 'preview',
            startedWithCliVersion: '1.2.3',
            serviceManaged: null,
            serviceLabel: null,
        })).toContain('unknown');
        expect(formatDaemonOwnerLabel({
            startedWithPublicReleaseChannel: 'preview',
            startedWithCliVersion: '1.2.3',
            serviceManaged: null,
            serviceLabel: null,
        })).not.toContain('manual start');
    });

    it('detects release-channel mismatch for the current invocation', () => {
        expect(hasDaemonOwnerMismatchForCurrentInvocation({
            currentCliVersion: '1.2.3',
            currentPublicReleaseChannel: 'dev',
            daemonState: {
                startedWithCliVersion: '1.2.3',
                startedWithPublicReleaseChannel: 'preview',
            },
        })).toBe(true);
    });
});
