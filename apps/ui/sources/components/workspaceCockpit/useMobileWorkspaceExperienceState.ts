import * as React from 'react';

import { useSetting, useSettingMutable } from '@/sync/domains/state/storage';
import { useDeviceType } from '@/utils/platform/responsive';

import {
    isMobileWorkspaceCockpitEnabled,
    isMobileWorkspaceExperienceLockedToClassic,
    resolveMobileWorkspaceExperience,
    resolveMobileWorkspaceExperienceToggleLabelKey,
    resolveNextMobileWorkspaceExperience,
    shouldShowMobileWorkspaceExperienceToggle,
    type MobileWorkspaceExperience,
} from './mobileWorkspaceExperience';

/** 统一会话页的有效体验与入口；原生手机固定聊天，但不修改用户原有持久偏好。 */
export function useMobileWorkspaceExperienceState(): Readonly<{
    deviceType: string | null | undefined;
    mobileWorkspaceExperience: MobileWorkspaceExperience;
    cockpitEnabled: boolean;
    showWorkspaceExperienceToggle: boolean;
    workspaceExperienceToggleLabelKey: 'workspaceCockpit.openClassicView' | 'workspaceCockpit.openCockpit';
    toggleWorkspaceExperience: () => void;
}> {
    const deviceType = useDeviceType();
    const mobileWorkspaceExperience = useSetting('mobileWorkspaceExperienceV1');
    const [, setMobileWorkspaceExperience] = useSettingMutable('mobileWorkspaceExperienceV1');

    return React.useMemo(() => ({
        deviceType,
        mobileWorkspaceExperience: resolveMobileWorkspaceExperience({ deviceType, mobileWorkspaceExperience }),
        cockpitEnabled: isMobileWorkspaceCockpitEnabled({
            deviceType,
            mobileWorkspaceExperience,
        }),
        showWorkspaceExperienceToggle: shouldShowMobileWorkspaceExperienceToggle({ deviceType }),
        workspaceExperienceToggleLabelKey: resolveMobileWorkspaceExperienceToggleLabelKey(resolveMobileWorkspaceExperience({ deviceType, mobileWorkspaceExperience })),
        toggleWorkspaceExperience: () => {
            // 即使旧菜单持有此回调，也不能从固定聊天入口回写工作台偏好。
            if (isMobileWorkspaceExperienceLockedToClassic({ deviceType })) return;
            setMobileWorkspaceExperience(resolveNextMobileWorkspaceExperience(mobileWorkspaceExperience));
        },
    }), [deviceType, mobileWorkspaceExperience, setMobileWorkspaceExperience]);
}
