import '@expo/metro-runtime';

declare const require: (id: string) => unknown;

if (typeof window !== 'undefined') {
    try {
        const mod = require('./sources/dev/webHmrOptOut/webHmrOptOut');
        if (typeof mod === 'object' && mod !== null && 'installWebHmrOptOutForWebTab' in mod) {
            const install = (mod as { installWebHmrOptOutForWebTab?: unknown }).installWebHmrOptOutForWebTab;
            if (typeof install === 'function') {
                install({
                    url: new URL(window.location.href),
                    sessionStorage: window.sessionStorage,
                    history: window.history,
                });
            }
        }
    } catch {
        // ignore
    }

    try {
        if (typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== 'undefined' && (globalThis as unknown as { __DEV__?: boolean }).__DEV__) {
            const mod = require('./sources/desktop/mcp/installTauriMcpWebviewDriverScripts');
            if (typeof mod === 'object' && mod !== null && 'installTauriMcpWebviewDriverScripts' in mod) {
                const install = (mod as { installTauriMcpWebviewDriverScripts?: unknown }).installTauriMcpWebviewDriverScripts;
                if (typeof install === 'function') {
                    install();
                }
            }
        }
    } catch {
        // ignore
    }
}

/**
 * 把未知值收成可读字段的对象。用于没有类型声明的 expo-constants 和预览门禁模块。
 */
function readRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null) return null;
    return value as Record<string, unknown>;
}

/**
 * 从 expo-constants 上读取已经写入配置的 Router 根。没有该字段时返回空字符串。
 */
function readRouterRoot(constants: Record<string, unknown> | null): string {
    const expoConfig = readRecord(constants?.expoConfig);
    const extra = readRecord(expoConfig?.extra);
    const router = readRecord(extra?.router);
    return typeof router?.root === 'string' ? router.root : '';
}

/**
 * 读取配置阶段选定的 Router 根。读取失败时返回空字符串，入口会继续加载正式 unistyles。
 */
function readEmbeddedExpoRouterRoot(): string {
    try {
        const constants = readRecord(require('expo-constants'));
        const direct = readRouterRoot(constants);
        if (direct) return direct;
        return readRouterRoot(readRecord(constants?.default));
    } catch {
        return '';
    }
}

/**
 * 判断当前进程是不是开发运行时。正式包里的 __DEV__ 为假，因此不会跳过 unistyles。
 */
function isCodexTopPreviewDevRuntime(): boolean {
    return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/**
 * 只有配置已经选中预览根且当前是开发运行时，才跳过正式 unistyles。
 * 正式 unistyles 会初始化主题持久化和同步，预览入口不能加载它。
 */
function shouldSkipOfficialUnistylesForCodexTopPreview(): boolean {
    const loaded = readRecord(require('./sources/dev/codexTopPreview/resolveCodexTopRouterRoot.cjs'));
    const decide = loaded?.shouldSkipOfficialUnistyles;
    if (typeof decide !== 'function') return false;
    const decision: unknown = (decide as (input: { embeddedRouterRoot: string; devRuntime: boolean }) => unknown)({
        embeddedRouterRoot: readEmbeddedExpoRouterRoot(),
        devRuntime: isCodexTopPreviewDevRuntime(),
    });
    return decision === true;
}

if (!shouldSkipOfficialUnistylesForCodexTopPreview()) {
    require('./sources/unistyles');
}
require('expo-router/entry');
