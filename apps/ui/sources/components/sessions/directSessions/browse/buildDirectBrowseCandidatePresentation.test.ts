import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { lightTheme } from '@/theme';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/ui/status/StatusDot', () => ({
    StatusDot: 'StatusDot',
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    const { zhHans } = await import('@/text/translations/zh-Hans');
    return createTextModuleMock({ translate: (key: string, params?: Record<string, unknown>) => {
        if (!key.startsWith('time.')) return key;
        const value = zhHans.time[key.slice(5) as keyof typeof zhHans.time];
        return typeof value === 'function' ? value(params as { count: number }) : value;
    } });
});

const mockTheme = {
    ...lightTheme,
    colors: {
        ...lightTheme.colors,
        text: {
            ...lightTheme.colors.text,
            secondary: '#666',
            tertiary: '#999',
        },
    },
};

describe('buildDirectBrowseCandidatePresentation', () => {
    afterEach(() => { vi.restoreAllMocks(); });
    it('renders full-path metadata with item-aligned text hierarchy and hides remote ids when a meaningful title exists', async () => {
        const { buildDirectBrowseCandidateSubtitle } = await import('./buildDirectBrowseCandidatePresentation');
        const subtitle = buildDirectBrowseCandidateSubtitle({
            remoteSessionId: 'codex-session-1',
            title: 'Improve browse session UX',
            updatedAtMs: 1_700_000_000_000,
            activity: 'active_recently',
            details: {
                path: '/Users/leeroy/Documents/Development/happier/dev',
            },
        }, mockTheme, 'compact');

        expect(React.isValidElement(subtitle)).toBe(true);
        expect((subtitle as any).type).toBe('Text');

        const screen = await renderScreen(React.createElement('View', null, subtitle));
        const textNodes = screen.findAllByType('Text');
        expect(String(textNodes[1]?.props?.children)).toMatch(/\d+天前/);
        expect(textNodes[1]?.props?.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: '#666' })]));
        expect(String(textNodes[3]?.props?.children)).toBe('/Users/leeroy/Documents/Development/happier/dev');
        expect(textNodes[3]?.props?.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: '#999' })]));
        expect(JSON.stringify(screen.tree.toJSON())).not.toContain('codex-session-1');
    });

    // 使用真实中文词条验证历史时间，不允许拼接固定英文后缀。
    it.each([[30_000, '现在'], [300_000, '5分钟前'], [7_200_000, '2小时前'], [259_200_000, '3天前']] as const)('localizes a %s ms history age', async (age, expected) => {
        vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
        const { buildDirectBrowseCandidateSubtitle } = await import('./buildDirectBrowseCandidatePresentation');
        const screen = await renderScreen(React.createElement('View', null, buildDirectBrowseCandidateSubtitle({
            remoteSessionId: 'synthetic-history', title: '示例任务', updatedAtMs: Date.now() - age, activity: 'idle',
        }, mockTheme, 'compact')));
        expect(JSON.stringify(screen.tree.toJSON())).toContain(expected);
        expect(JSON.stringify(screen.tree.toJSON())).not.toContain(' ago');
    });

    it('falls back to the remote session id when there is no meaningful title or path', async () => {
        const { buildDirectBrowseCandidateDisplayTitle, buildDirectBrowseCandidateSubtitle } = await import('./buildDirectBrowseCandidatePresentation');
        expect(buildDirectBrowseCandidateDisplayTitle({
            remoteSessionId: 'sess_raw_1',
            updatedAtMs: 1_700_000_000_000,
        })).toBe('sess_raw_1');
        const subtitle = buildDirectBrowseCandidateSubtitle({
            remoteSessionId: 'sess_raw_1',
            updatedAtMs: 1_700_000_000_000,
            activity: 'idle',
        }, mockTheme, 'compact');

        const screen = await renderScreen(React.createElement('View', null, subtitle));
        expect(JSON.stringify(screen.tree.toJSON())).toContain('sess_raw_1');
    });

    it('shows running now instead of a stale relative timestamp for running sessions', async () => {
        const { buildDirectBrowseCandidateSubtitle } = await import('./buildDirectBrowseCandidatePresentation');
        const subtitle = buildDirectBrowseCandidateSubtitle({
            remoteSessionId: 'sess_live_1',
            title: 'Live codex session',
            updatedAtMs: 1_700_000_000_000,
            activity: 'running',
            details: {
                cwd: '/tmp/happier/dev',
            },
        }, mockTheme, 'compact');

        const screen = await renderScreen(React.createElement('View', null, subtitle));
        expect(JSON.stringify(screen.tree.toJSON())).toContain('directSessions.browseActivityRunningNow');
        expect(JSON.stringify(screen.tree.toJSON())).toContain('/tmp/happier/dev');
        expect(JSON.stringify(screen.tree.toJSON())).not.toContain('3y ago');
    });
});
