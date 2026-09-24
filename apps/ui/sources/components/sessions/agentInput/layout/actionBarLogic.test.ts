import { describe, expect, it } from 'vitest';
import {
    getHasAnyAgentInputActions,
    resolveAgentInputActionBarLayout,
    shouldShowSecondaryControlRow,
} from './actionBarLogic';

describe('agentInput/actionBarLogic', () => {
    it('shows the secondary controls row in wrap and scroll modes when controls exist', () => {
        expect(shouldShowSecondaryControlRow('wrap', true)).toBe(true);
        expect(shouldShowSecondaryControlRow('wrap', false)).toBe(false);
        expect(shouldShowSecondaryControlRow('scroll', true)).toBe(true);
        expect(shouldShowSecondaryControlRow('scroll', false)).toBe(false);
        expect(shouldShowSecondaryControlRow('collapsed', true)).toBe(false);
    });

    it('resolves auto layout to scroll on web so controls stay in two compact rows', () => {
        expect(resolveAgentInputActionBarLayout({
            configuredLayout: 'auto',
            platform: 'web',
            isMobileLayout: false,
        })).toBe('scroll');
    });

    it('preserves explicit action bar layout settings', () => {
        expect(resolveAgentInputActionBarLayout({
            configuredLayout: 'wrap',
            platform: 'web',
            isMobileLayout: false,
        })).toBe('wrap');
        expect(resolveAgentInputActionBarLayout({
            configuredLayout: 'collapsed',
            platform: 'ios',
            isMobileLayout: true,
        })).toBe('collapsed');
    });

    it('treats resume as an action (prevents collapsed menu from being empty)', () => {
        expect(getHasAnyAgentInputActions({
            showPermissionChip: false,
            hasProfile: false,
            hasEnvVars: false,
            hasAgent: false,
            hasRecipient: false,
            hasDelivery: false,
            hasExtraActionChips: false,
            hasMachine: false,
            hasPath: false,
            hasResume: true,
            hasFiles: false,
            hasStop: false,
        })).toBe(true);
    });

    it('returns false when there are no actions', () => {
        expect(getHasAnyAgentInputActions({
            showPermissionChip: false,
            hasProfile: false,
            hasEnvVars: false,
            hasAgent: false,
            hasRecipient: false,
            hasDelivery: false,
            hasExtraActionChips: false,
            hasMachine: false,
            hasPath: false,
            hasResume: false,
            hasFiles: false,
            hasStop: false,
        })).toBe(false);
    });

    it('treats delivery as an action so collapsed controls stay reachable', () => {
        expect(getHasAnyAgentInputActions({
            showPermissionChip: false,
            hasProfile: false,
            hasEnvVars: false,
            hasAgent: false,
            hasRecipient: false,
            hasDelivery: true,
            hasExtraActionChips: false,
            hasMachine: false,
            hasPath: false,
            hasResume: false,
            hasFiles: false,
            hasStop: false,
        })).toBe(true);
    });

    it('treats canonical extra action chips as actions so collapsed controls stay reachable', () => {
        expect(getHasAnyAgentInputActions({
            showPermissionChip: false,
            hasProfile: false,
            hasEnvVars: false,
            hasAgent: false,
            hasRecipient: false,
            hasDelivery: false,
            hasExtraActionChips: true,
            hasMachine: false,
            hasPath: false,
            hasResume: false,
            hasFiles: false,
            hasStop: false,
        })).toBe(true);
    });
});
