import { describe, expect, it } from 'vitest';

import {
    isMobileWorkspaceCockpitEnabled,
    normalizeMobileWorkspaceExperience,
    resolveMobileWorkspaceExperienceToggleActionId,
    resolveMobileWorkspaceExperienceToggleLabelKey,
    resolveNextMobileWorkspaceExperience,
    shouldShowMobileWorkspaceExperienceToggle,
} from './mobileWorkspaceExperience';

describe('mobileWorkspaceExperience', () => {
    it('defaults missing or unknown values to cockpit while preserving explicit classic', () => {
        expect(normalizeMobileWorkspaceExperience(undefined)).toBe('cockpit');
        expect(normalizeMobileWorkspaceExperience(null)).toBe('cockpit');
        expect(normalizeMobileWorkspaceExperience('legacy')).toBe('cockpit');
        expect(normalizeMobileWorkspaceExperience('classic')).toBe('classic');
    });

    it('preserves an unset mobile-web preference as cockpit-enabled', () => {
        expect(isMobileWorkspaceCockpitEnabled({
            deviceType: 'phone',
            mobileWorkspaceExperience: undefined,
            platformOS: 'web',
        })).toBe(true);
    });

    it.each(['ios', 'android'])('keeps %s phones in classic for new and previously cockpit accounts', (platformOS) => {
        for (const mobileWorkspaceExperience of [undefined, 'cockpit', 'classic']) {
            expect(isMobileWorkspaceCockpitEnabled({ deviceType: 'phone', mobileWorkspaceExperience, platformOS })).toBe(false);
            expect(shouldShowMobileWorkspaceExperienceToggle({ deviceType: 'phone', platformOS })).toBe(false);
        }
    });

    it('toggles an unset preference back to classic', () => {
        expect(resolveNextMobileWorkspaceExperience(undefined)).toBe('classic');
        expect(resolveMobileWorkspaceExperienceToggleActionId(undefined)).toBe('header.openMobileWorkspaceClassic');
        expect(resolveMobileWorkspaceExperienceToggleLabelKey(undefined)).toBe('workspaceCockpit.openClassicView');
    });
});
