import { describe, expect, it } from 'vitest';

import { resolveSessionWorkspacePresentation } from './sessionWorkspacePresentation';

const machines = {
    m1: {
        id: 'm1',
        active: true,
        activeAt: 0,
        updatedAt: 0,
        revokedAt: null,
        metadataVersion: 1,
        metadata: {
            host: 'machine',
            homeDir: '/Users/lee',
        },
    },
};

describe('resolveSessionWorkspacePresentation', () => {
    it('uses the workspace basename as the default display title while preserving the display path', () => {
        const presentation = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
        });

        expect(presentation.displayPath).toBe('~/Documents/Development/happier/remote-dev');
        expect(presentation.displayTitle).toBe('remote-dev');
    });

    it('keeps custom workspace labels above basename and full-path display settings', () => {
        const base = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
        });

        const presentation = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
            workspaceLabelsV1: {
                [base.workspaceKey]: 'Preview app',
            },
            workspacePathDisplayModeV1: 'path',
        });

        expect(presentation.displayTitle).toBe('Preview app');
        expect(presentation.hasCustomLabel).toBe(true);
    });

    it('can display the formatted full path when the account setting requests it', () => {
        const presentation = resolveSessionWorkspacePresentation({
            metadata: {
                machineId: 'm1',
                path: '/Users/lee/Documents/Development/happier/remote-dev',
                homeDir: '/Users/lee',
            },
            machines,
            workspacePathDisplayModeV1: 'path',
        });

        expect(presentation.displayTitle).toBe('~/Documents/Development/happier/remote-dev');
    });
});
