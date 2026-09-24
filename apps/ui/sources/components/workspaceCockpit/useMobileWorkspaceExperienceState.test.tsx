import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, standardCleanup } from '@/dev/testkit';

const state = vi.hoisted(() => ({ platformOS: 'android', deviceType: 'phone', preference: undefined as string | undefined, persist: vi.fn() }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { get OS() { return state.platformOS; } } });
});
vi.mock('@/utils/platform/responsive', () => ({ useDeviceType: () => state.deviceType }));
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({ useSetting: () => state.preference, useSettingMutable: () => [state.preference, state.persist] });
});

import { useMobileWorkspaceExperienceState } from './useMobileWorkspaceExperienceState';

afterEach(() => { standardCleanup(); state.persist.mockClear(); state.platformOS = 'android'; state.deviceType = 'phone'; state.preference = undefined; });

describe('native phone workspace experience', () => {
    it.each([undefined, 'classic', 'cockpit'])('keeps preference %s unchanged while forcing classic and hiding the switch', async (preference) => {
        state.preference = preference;
        const hook = await renderHook(useMobileWorkspaceExperienceState);
        expect(hook.getCurrent()).toMatchObject({ mobileWorkspaceExperience: 'classic', cockpitEnabled: false, showWorkspaceExperienceToggle: false });
        await act(async () => { hook.getCurrent().toggleWorkspaceExperience(); });
        expect(state.persist).not.toHaveBeenCalled();
        expect(state.preference).toBe(preference);
    });

    it('keeps mobile web cockpit and its explicit setting action available', async () => {
        state.platformOS = 'web';
        const hook = await renderHook(useMobileWorkspaceExperienceState);
        expect(hook.getCurrent()).toMatchObject({ mobileWorkspaceExperience: 'cockpit', cockpitEnabled: true, showWorkspaceExperienceToggle: true });
        await act(async () => { hook.getCurrent().toggleWorkspaceExperience(); });
        expect(state.persist).toHaveBeenCalledWith('classic');
    });

    it.each(['desktop', 'tablet'])('keeps %s defaults and existing absence of the phone cockpit', async (deviceType) => {
        state.deviceType = deviceType;
        const hook = await renderHook(useMobileWorkspaceExperienceState);
        expect(hook.getCurrent()).toMatchObject({ mobileWorkspaceExperience: 'cockpit', cockpitEnabled: false, showWorkspaceExperienceToggle: false });
        expect(state.persist).not.toHaveBeenCalled();
    });
});
