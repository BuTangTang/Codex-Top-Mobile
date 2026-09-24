const OFFICIAL_ROUTER_ROOT = './sources/app';
const CODEX_TOP_PREVIEW_ROUTER_ROOT = './sources/dev/codexTopPreview/app';

/**
 * 判断显式预览开关是否打开。
 * 只接受 1/true/yes/on；空值和其它写法都当作关闭，避免含糊环境变量打开预览。
 * @param {unknown} raw
 * @returns {boolean}
 */
function isExplicitCodexTopPreviewSwitch(raw) {
    const value = String(raw ?? '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * 决定 Expo Router 根目录。
 * 必须同时满足显式开关、逻辑变体 development、以及开发运行时；否则回到正式 sources/app。
 * @param {{ previewSwitch: unknown, logicalVariant: unknown, devRuntime: unknown }} input
 * @returns {string}
 */
function resolveCodexTopRouterRoot(input) {
    const enabled = isExplicitCodexTopPreviewSwitch(input.previewSwitch);
    const developmentVariant = input.logicalVariant === 'development';
    const devRuntime = input.devRuntime === true;
    if (enabled && developmentVariant && devRuntime) {
        return CODEX_TOP_PREVIEW_ROUTER_ROOT;
    }
    return OFFICIAL_ROUTER_ROOT;
}

/**
 * 判断入口是否跳过正式 unistyles。
 * 只信任配置里已经写好的根目录，不再单独解释变体，这样入口不会和 Expo Router 选中的目录不一致。
 * 非开发运行时即使根目录被写成预览，也返回 false，正式包仍会加载原来的样式初始化。
 * @param {{ embeddedRouterRoot: unknown, devRuntime: unknown }} input
 * @returns {boolean}
 */
function shouldSkipOfficialUnistyles(input) {
    return input.devRuntime === true && input.embeddedRouterRoot === CODEX_TOP_PREVIEW_ROUTER_ROOT;
}

module.exports = {
    OFFICIAL_ROUTER_ROOT,
    CODEX_TOP_PREVIEW_ROUTER_ROOT,
    isExplicitCodexTopPreviewSwitch,
    resolveCodexTopRouterRoot,
    shouldSkipOfficialUnistyles,
};
