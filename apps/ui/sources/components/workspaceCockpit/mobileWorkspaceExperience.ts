import { Platform } from 'react-native';

export type MobileWorkspaceExperience = 'classic' | 'cockpit';
export type MobileWorkspaceExperienceToggleActionId =
    | 'header.openMobileWorkspaceCockpit'
    | 'header.openMobileWorkspaceClassic';

type MobileWorkspaceEnvironment = Readonly<{ deviceType: string | null | undefined; platformOS?: string }>;

/** 正式原生手机固定简洁聊天；网页、平板和桌面不受这条产品约定影响。 */
export function isMobileWorkspaceExperienceLockedToClassic(input: MobileWorkspaceEnvironment): boolean {
    return input.deviceType === 'phone' && (input.platformOS ?? Platform.OS) !== 'web';
}

/** 只决定有效呈现方式，不回写或迁移账号中已保存的工作台偏好。 */
export function resolveMobileWorkspaceExperience(input: MobileWorkspaceEnvironment & Readonly<{ mobileWorkspaceExperience: string | null | undefined }>): MobileWorkspaceExperience {
    return isMobileWorkspaceExperienceLockedToClassic(input) ? 'classic' : normalizeMobileWorkspaceExperience(input.mobileWorkspaceExperience);
}

/** 保留原始偏好的兼容归一化，供不受手机产品约束的界面继续使用。 */
export function normalizeMobileWorkspaceExperience(
    value: string | null | undefined,
): MobileWorkspaceExperience {
    return value === 'classic' ? 'classic' : 'cockpit';
}

/** 计算可切换界面的下一个偏好，不在此处写入持久设置。 */
export function resolveNextMobileWorkspaceExperience(
    currentValue: string | null | undefined,
): MobileWorkspaceExperience {
    return normalizeMobileWorkspaceExperience(currentValue) === 'cockpit' ? 'classic' : 'cockpit';
}

/** 为旧设置入口解析当前偏好的标题。 */
export function resolveMobileWorkspaceExperienceTitleKey(
    value: string | null | undefined,
): 'settingsSession.mobileWorkspaceExperience.options.classicTitle' | 'settingsSession.mobileWorkspaceExperience.options.cockpitTitle' {
    return normalizeMobileWorkspaceExperience(value) === 'cockpit'
        ? 'settingsSession.mobileWorkspaceExperience.options.cockpitTitle'
        : 'settingsSession.mobileWorkspaceExperience.options.classicTitle';
}

/** 保持已有可切换界面的动作标识。 */
export function resolveMobileWorkspaceExperienceToggleActionId(
    value: string | null | undefined,
): MobileWorkspaceExperienceToggleActionId {
    return normalizeMobileWorkspaceExperience(value) === 'cockpit'
        ? 'header.openMobileWorkspaceClassic'
        : 'header.openMobileWorkspaceCockpit';
}

/** 为仍允许切换的界面解析动作名称。 */
export function resolveMobileWorkspaceExperienceToggleLabelKey(
    value: string | null | undefined,
): 'workspaceCockpit.openClassicView' | 'workspaceCockpit.openCockpit' {
    return normalizeMobileWorkspaceExperience(value) === 'cockpit'
        ? 'workspaceCockpit.openClassicView'
        : 'workspaceCockpit.openCockpit';
}

/** 原生手机隐藏工作台切换，其他设备延续原来的入口条件。 */
export function shouldShowMobileWorkspaceExperienceToggle(input: MobileWorkspaceEnvironment): boolean {
    return input.deviceType === 'phone' && !isMobileWorkspaceExperienceLockedToClassic(input);
}

/** 会话路由与底栏共用这一判断，避免出现经典聊天搭配工作台五入口。 */
export function isMobileWorkspaceCockpitEnabled(input: MobileWorkspaceEnvironment & Readonly<{
    mobileWorkspaceExperience: string | null | undefined;
}>): boolean {
    return input.deviceType === 'phone' && resolveMobileWorkspaceExperience(input) === 'cockpit';
}
