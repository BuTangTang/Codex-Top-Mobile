import { describe, expect, it } from 'vitest';

import { t } from '@/text';

import { buildConnectedServiceAccountSwitchMessage } from './connectedServiceAccountSwitchMessage';

describe('buildConnectedServiceAccountSwitchMessage', () => {
    it('renders a group-driven switch as a group switch between profile labels', () => {
        const message = buildConnectedServiceAccountSwitchMessage({
            event: {
                serviceId: 'claude-subscription',
                groupId: 'team-pool',
                groupLabel: 'Team pool',
                fromProfileId: 'batiplus',
                toProfileId: 'batiplus',
            },
            labelsByKey: { 'claude-subscription/batiplus': 'leeroy' },
        });

        expect(message).not.toContain('batiplus');
        expect(message).not.toContain('from group');
        expect(message).not.toContain('to profile');
        expect(message).toContain('Switched Claude group Team pool');
        expect(message).toContain('leeroy');
        expect(message).toContain('from leeroy to leeroy');
    });

    it('uses labels carried by the transcript event when settings labels are not hydrated', () => {
        const message = buildConnectedServiceAccountSwitchMessage({
            event: {
                serviceId: 'claude-subscription',
                groupId: 'team-pool',
                groupLabel: 'Team pool',
                fromProfileId: 'batiplus',
                toProfileId: 'batiplus',
                fromProfileLabel: 'leeroy',
                toProfileLabel: 'leeroy',
            },
            labelsByKey: undefined,
        });

        expect(message).not.toContain('batiplus');
        expect(message).toContain('Switched Claude group Team pool');
        expect(message).toContain('from leeroy to leeroy');
    });

    it('falls back to the group id for older group switch events without a group label', () => {
        const message = buildConnectedServiceAccountSwitchMessage({
            event: {
                serviceId: 'claude-subscription',
                groupId: 'team-pool',
                fromProfileId: 'batiplus',
                toProfileId: 'batiplus',
                fromProfileLabel: 'leeroy',
                toProfileLabel: 'leeroy',
            },
            labelsByKey: undefined,
        });

        expect(message).toContain('Switched Claude group team-pool');
        expect(message).not.toContain('group Claude');
    });

    it('describes both endpoints as profiles for a direct (non-group) switch', () => {
        const message = buildConnectedServiceAccountSwitchMessage({
            event: {
                serviceId: 'openai-codex',
                groupId: null,
                fromProfileId: 'work',
                toProfileId: 'backup',
            },
            labelsByKey: { 'openai-codex/work': 'Work', 'openai-codex/backup': 'Backup' },
        });

        expect(message).toContain('Switched Codex account');
        expect(message).toContain('from Work to Backup');
        expect(message).not.toContain('group Codex');
    });

    it('falls back to the native CLI-auth label when an endpoint profile is missing', () => {
        const message = buildConnectedServiceAccountSwitchMessage({
            event: {
                serviceId: 'openai-codex',
                groupId: 'team',
                fromProfileId: null,
                toProfileId: 'team',
            },
            labelsByKey: {},
        });

        expect(message).toContain(t('connectedServices.authChip.nativeLabel'));
        expect(message).not.toContain('from null');
    });

    it('falls back to the raw profile id only when no label is configured', () => {
        const message = buildConnectedServiceAccountSwitchMessage({
            event: {
                serviceId: 'openai-codex',
                groupId: null,
                fromProfileId: 'work',
                toProfileId: 'backup',
            },
            labelsByKey: undefined,
        });

        expect(message).toContain('work');
        expect(message).toContain('backup');
    });
});
