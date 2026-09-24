import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import type { Settings } from '@/sync/domains/settings/settings';

const device = vi.hoisted(() => ({ os: 'web', width: 390, height: 844 }));

// 只替换原生尺寸边界，保留真实的手机/平板判定。
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: { get OS() { return device.os; } },
        useWindowDimensions: () => ({ width: device.width, height: device.height }),
    });
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

const settingValues = {
    sessionReplayEnabled: false,
    sessionReplayMaxSeedChars: 1200,
    sessionReplayStrategy: 'recent_messages',
    sessionReplaySummaryRunnerV1: null,
    sessionThinkingDisplayMode: 'inline',
    sessionThinkingInlineChrome: 'card',
    sessionThinkingInlinePresentation: 'summary',
    toolViewTimelineChromeMode: 'cards',
    transcriptMessageTimestampDisplayMode: 'hover_web_hidden_mobile',
    transcriptMessageSelectionEnabled: false,
    transcriptMessageSendToSessionEnabled: true,
    transcriptStreamingMarkdownRenderingEnabled: true,
    transcriptStreamingPartialOutputEnabled: true,
    transcriptStreamingSettleDelayMs: 90,
    transcriptStreamingSmoothingEnabled: true,
    transcriptToolCallsCollapsedPreviewCount: 5,
    transcriptToolCallsGroupShowBackground: true,
} satisfies Partial<Settings>;

// Storage is a testkit-owned boundary: stub it through `@/dev/testkit/mocks/storage` so the whole
// module surface stays in step with its owner. A hand-rolled literal here silently omits every export
// the hook grows next (it previously dropped `useLocalSetting`, which `useSessionDebugInformationEnabled`
// reads), turning an owner change into an unrelated red test.
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub, createUseSettingMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useSessionForkSupportSource: () => null,
        useSessionMessagesById: () => ({}),
        useSessionMessagesReducerState: () => null,
        useSessionWorkspacePath: () => '/repo',
        useSetting: createUseSettingMock({ values: settingValues }),
    });
});

describe('useTranscriptSessionCommon', () => {
    beforeEach(() => Object.assign(device, { os: 'web', width: 390, height: 844 }));

    // 手机默认只保留可展开摘要；窄网页与原生平板继续服从原设置。
    it.each([
        ['android', 390, 844, true],
        ['ios', 844, 390, true],
        ['android', 800, 1280, false],
        ['web', 390, 844, false],
    ])('limits compact tools to %s at %sx%s: %s', async (os, width, height, compact) => {
        Object.assign(device, { os, width, height });
        const { useTranscriptSessionCommon } = await import('./transcriptSessionCommon');
        const hook = await renderHook(() => useTranscriptSessionCommon('s1'));

        expect(hook.getCurrent().toolChrome).toMatchObject({
            compactToolCalls: compact,
            toolViewTimelineChromeMode: compact ? 'activity_feed' : 'cards',
            transcriptToolCallsCollapsedPreviewCount: compact ? 0 : 5,
            transcriptToolCallsGroupShowBackground: !compact,
        });
        await hook.unmount();
    });

    it('includes row-level transcript message action settings in message display common', async () => {
        const { useTranscriptSessionCommon } = await import('./transcriptSessionCommon');
        const hook = await renderHook(() => useTranscriptSessionCommon('s1'));

        expect(hook.getCurrent().messageDisplay.transcriptMessageSelectionEnabled).toBe(false);
        expect(hook.getCurrent().messageDisplay.transcriptMessageSendToSessionEnabled).toBe(true);

        await hook.unmount();
        standardCleanup();
    });
});
