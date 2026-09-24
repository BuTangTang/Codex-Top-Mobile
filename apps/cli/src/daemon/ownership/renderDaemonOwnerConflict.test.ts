import { describe, expect, it } from 'vitest';

import { renderDaemonOwnerConflict } from './renderDaemonOwnerConflict';

describe('renderDaemonOwnerConflict', () => {
    const legacyOwner = {
        status: 'running' as const,
        source: 'state' as const,
        state: {
            pid: 123,
            httpPort: 43110,
            startedAt: Date.now(),
            startedWithCliVersion: '1.2.3',
            startedWithPublicReleaseChannel: 'preview' as const,
        },
        currentCliVersion: '9.9.9',
        currentPublicReleaseChannel: 'stable' as const,
        versionMatches: false,
        releaseChannelMatches: false,
        serviceManaged: null,
        startupSource: 'unknown' as const,
    };
    const serviceOwner = {
        ...legacyOwner,
        serviceManaged: true as const,
        startupSource: 'background-service' as const,
        state: {
            ...legacyOwner.state,
            serviceLabel: 'com.happier.cli.daemon.default',
        },
    };

    it('keeps daemon stop guidance neutral when the current owner source is unknown', () => {
        const rendered = renderDaemonOwnerConflict({
            intent: 'daemon-stop',
            owner: legacyOwner,
        });

        expect(rendered.title).toContain('could not determine how the current daemon was started');
        expect(rendered.lines.join(' ')).toContain('Use `happier service stop` only if you know');
    });

    it('suggests takeover for daemon start when the current owner source is unknown', () => {
        const rendered = renderDaemonOwnerConflict({
            intent: 'daemon-start',
            owner: legacyOwner,
        });

        expect(rendered.title).toContain('running daemon');
        expect(rendered.title).not.toContain('relay owner');
        expect(rendered.lines.join(' ')).toContain('Stop the current daemon');
        expect(rendered.lines.join(' ')).toContain('daemon start --takeover');
    });

    it('suggests takeover for daemon restart when a manually started daemon is already running', () => {
        const rendered = renderDaemonOwnerConflict({
            intent: 'daemon-restart',
            owner: {
                ...legacyOwner,
                serviceManaged: false as const,
                startupSource: 'manual' as const,
            },
        });

        expect(rendered.title).toContain('manually started daemon');
        expect(rendered.lines.join(' ')).toContain('daemon restart --takeover');
        expect(rendered.lines.join(' ')).not.toContain('service restart');
    });

    it('tells daemon restart callers to use doctor repair for a service-managed owner', () => {
        const rendered = renderDaemonOwnerConflict({
            intent: 'daemon-restart',
            owner: serviceOwner,
        });

        expect(rendered.title).toContain('background service');
        expect(rendered.lines.join(' ')).toContain('Use `happier doctor repair`');
        expect(rendered.lines.join(' ')).not.toContain('Use `happier service stop`');
    });

    it('mentions both legacy takeover and service restart guidance when daemon restart owner source is unknown', () => {
        const rendered = renderDaemonOwnerConflict({
            intent: 'daemon-restart',
            owner: legacyOwner,
        });

        expect(rendered.title).toContain('could not determine how the current daemon was started');
        expect(rendered.lines.join(' ')).toContain('daemon restart --takeover');
        expect(rendered.lines.join(' ')).toContain('service restart');
    });
});
