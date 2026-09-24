import { afterEach, describe, expect, it } from 'vitest';

import { en } from './translations/en';
import { zhHans } from './translations/zh-Hans';
import { hasTranslation, setPreferredLanguageFromSettings, t, tLoose } from './i18n';

describe('text/i18n', () => {
    afterEach(() => {
        setPreferredLanguageFromSettings(null);
    });

    /** 首次读取和动态文案都由简体中文词库提供。 */
    it('translates the Chinese product language and nested function entries', () => {
        expect(t('tabs.inbox')).toBe(zhHans.tabs.inbox);
        expect(t('promptLibrary.profileStacksSubtitle', { count: 2 })).toBe(zhHans.promptLibrary.profileStacksSubtitle({ count: 2 }));
        expect(tLoose('tabs.inbox')).toBe(zhHans.tabs.inbox);
    });

    it('uses the Antigravity product name for the agy backend', () => {
        expect(en.settingsProviders.plugins.agy.title).toBe('Antigravity');
        expect(en.agentInput.agent.agy).toBe('Antigravity');
        expect(en.profiles.aiBackend.agySubtitleExperimental).toBe('Antigravity CLI (experimental)');
    });

    it('reports missing keys without throwing', () => {
        expect(hasTranslation('tabs.inbox')).toBe(true);
        expect(hasTranslation('not.a.real.key')).toBe(false);
        expect(tLoose('not.a.real.key')).toBe('not.a.real.key');
    });

    /** 旧账号的语言设置或清空设置均不能改变产品的简体中文显示。 */
    it.each(['en', 'ru', 'zh-Hant', null, 'kl'])('keeps Chinese when the saved preference is %s', (value) => {
        setPreferredLanguageFromSettings(value);
        expect(t('tabs.inbox')).toBe(zhHans.tabs.inbox);
        expect(t('promptLibrary.profileStacksSubtitle', { count: 2 })).toBe(
            zhHans.promptLibrary.profileStacksSubtitle({ count: 2 }),
        );
        setPreferredLanguageFromSettings(null);
        expect(t('common.error')).toBe(zhHans.common.error);
    });

    /** 未知的历史语言值同样保留简体中文。 */
    it('ignores an unsupported preferred language instead of losing translations', () => {
        setPreferredLanguageFromSettings('kl');
        expect(t('tabs.inbox')).toBe(zhHans.tabs.inbox);
    });
});
