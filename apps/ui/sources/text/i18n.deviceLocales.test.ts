import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDeviceLocales: vi.fn(() => [{ languageCode: 'en', languageScriptCode: null as string | null }]),
}));

// 设备语言属于系统边界；翻译树和选择逻辑保持真实。
vi.mock('./deviceLocales', () => ({ getDeviceLocales: mocks.getDeviceLocales }));

describe('Codex Top Chinese product language', () => {
    /** 每例模拟冷启动，避免先前模块状态掩盖首次显示。 */
    beforeEach(() => { vi.resetModules(); mocks.getDeviceLocales.mockClear(); });

    /** 英文系统、繁体系统和无设备语言都必须首次显示简体中文。 */
    it.each([
        [{ languageCode: 'en', languageScriptCode: null }],
        [{ languageCode: 'zh', languageScriptCode: 'Hant' }],
        [],
    ])('uses Chinese on a cold start with device locales %j', async (...locales) => {
        mocks.getDeviceLocales.mockReturnValue(locales);
        const { t, tLoose, DEFAULT_LANGUAGE } = await import('./i18n');
        expect(DEFAULT_LANGUAGE).toBe('zh-Hans');
        expect(t('common.error')).toBe('错误');
        expect(tLoose('tabs.settings')).toBe('设置');
    });
});
