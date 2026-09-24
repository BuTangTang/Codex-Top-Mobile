import type { TabType } from './tabTypes';

/** 手机主导航只暴露会话、电脑和个人设置，不改变桌面保存的历史 tab 类型。 */
export function resolveTabBarTabs(): TabType[] {
    return ['sessions', 'machines', 'settings'];
}
