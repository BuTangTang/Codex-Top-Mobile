import * as React from 'react';
import { Platform } from 'react-native';

import type { Message } from '@/sync/domains/messages/messageTypes';
import type { Settings } from '@/sync/domains/settings/settings';
import type { SessionForkSupportSource } from '@/sync/domains/sessionFork/forkUiSupport';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import type { ReducerState } from '@/sync/reducer/reducer';
import { useSessionDebugInformationEnabled } from '@/sync/runtime/useSessionDebugInformationEnabled';
import {
    useSessionForkSupportSource,
    useSessionMessagesById,
    useSessionMessagesReducerState,
    useSessionWorkspacePath,
    useSetting,
} from '@/sync/domains/state/storage';
import type { TranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import { useDeviceType } from '@/utils/platform/responsive';

export type TranscriptSessionCommonSettings = Pick<Settings,
    | 'sessionReplayEnabled'
    | 'sessionReplayMaxSeedChars'
    | 'sessionReplayStrategy'
    | 'sessionReplaySummaryRunnerV1'
    | 'sessionThinkingDisplayMode'
    | 'sessionThinkingInlineChrome'
    | 'sessionThinkingInlinePresentation'
    | 'toolViewTimelineChromeMode'
    | 'transcriptMessageTimestampDisplayMode'
    | 'transcriptMessageSelectionEnabled'
    | 'transcriptMessageSendToSessionEnabled'
    | 'transcriptStreamingMarkdownRenderingEnabled'
    | 'transcriptStreamingPartialOutputEnabled'
    | 'transcriptStreamingSettleDelayMs'
    | 'transcriptStreamingSmoothingEnabled'
    | 'transcriptToolCallsCollapsedPreviewCount'
    | 'transcriptToolCallsGroupShowBackground'
>;

export type TranscriptMessageDisplayCommon = Pick<TranscriptSessionCommonSettings,
    | 'sessionThinkingDisplayMode'
    | 'sessionThinkingInlineChrome'
    | 'sessionThinkingInlinePresentation'
    | 'transcriptMessageTimestampDisplayMode'
    | 'transcriptMessageSelectionEnabled'
    | 'transcriptMessageSendToSessionEnabled'
    | 'transcriptStreamingMarkdownRenderingEnabled'
    | 'transcriptStreamingPartialOutputEnabled'
    | 'transcriptStreamingSettleDelayMs'
    | 'transcriptStreamingSmoothingEnabled'
> & Readonly<{
    workspacePath: string | null;
    /**
     * Carried as a prop so the transcript list resolves it once for every row it hoists common
     * props to. Rows that fall back to the standalone `MessageView` wrapper resolve this hook set
     * themselves, as they already do for every other setting here.
     */
    debugInformationEnabled: boolean;
}>;

export type TranscriptForkCommon = Pick<TranscriptSessionCommonSettings,
    | 'sessionReplayEnabled'
    | 'sessionReplayMaxSeedChars'
    | 'sessionReplayStrategy'
    | 'sessionReplaySummaryRunnerV1'
> & Readonly<{
    executionRunsEnabled: boolean;
    /**
     * `sessions.agentSwitching` for THIS Session's server, resolved once for the
     * whole transcript rather than per row. Source-context continuation is
     * reachable from a message's fork launcher, so the row needs the same
     * decision the in-Session picker uses.
     */
    agentSwitchingEnabled: boolean;
    sessionForkSupportSource: SessionForkSupportSource | null;
}>;

export function deriveTranscriptForkCommonForInteraction(
    forkCommon: TranscriptForkCommon,
    interaction: TranscriptInteraction | null | undefined,
): TranscriptForkCommon {
    if (interaction?.canFork === true || forkCommon.sessionForkSupportSource == null) return forkCommon;
    return {
        ...forkCommon,
        sessionForkSupportSource: null,
    };
}

export type TranscriptToolChromeCommon = Pick<TranscriptSessionCommonSettings,
    | 'toolViewTimelineChromeMode'
    | 'transcriptToolCallsCollapsedPreviewCount'
    | 'transcriptToolCallsGroupShowBackground'
> & Readonly<{
    /** 原生手机将工具过程收进同一行摘要，展开状态仍由原列表管理。 */
    compactToolCalls?: boolean;
}>;

export type TranscriptToolRouteCommon = Readonly<{
    messagesById: Readonly<Record<string, Message>>;
    reducerState: ReducerState | null;
}>;

export type TranscriptSessionCommon = Readonly<{
    fork: TranscriptForkCommon;
    messageDisplay: TranscriptMessageDisplayCommon;
    toolChrome: TranscriptToolChromeCommon;
    toolRoute: TranscriptToolRouteCommon;
}>;

export type TranscriptSessionCommonProps = Readonly<{
    forkCommon: TranscriptForkCommon;
    messageDisplayCommon: TranscriptMessageDisplayCommon;
    toolChromeCommon: TranscriptToolChromeCommon;
    toolRouteCommon: TranscriptToolRouteCommon;
}>;

export function hasTranscriptSessionCommonProps(
    props: Partial<TranscriptSessionCommonProps>,
): props is TranscriptSessionCommonProps {
    return props.forkCommon != null
        && props.messageDisplayCommon != null
        && props.toolChromeCommon != null
        && props.toolRouteCommon != null;
}

/** 汇总会话展示设置，并在这里统一派生手机工具摘要策略。 */
export function useTranscriptSessionCommon(sessionId: string): TranscriptSessionCommon {
    const deviceType = useDeviceType();
    const compactToolCalls = (Platform.OS === 'ios' || Platform.OS === 'android') && deviceType === 'phone';
    const sessionForkSupportSource = useSessionForkSupportSource(sessionId);
    const workspacePath = useSessionWorkspacePath(sessionId);
    const messagesById = useSessionMessagesById(sessionId);
    const reducerState = useSessionMessagesReducerState(sessionId);
    const executionRunsEnabled = useFeatureEnabled('execution.runs');
    // The server the fork launchers spawn the child on, resolved through the one
    // owner they already use, so the decision below is scoped to that exact
    // server rather than to whatever the sidebar happens to have selected.
    const forkSpawnServerId = usePreferredServerIdForSession(sessionId);
    const agentSwitchingEnabled = useFeatureEnabled('sessions.agentSwitching', {
        scopeKind: 'spawn',
        serverId: forkSpawnServerId,
    });
    const debugInformationEnabled = useSessionDebugInformationEnabled();

    const sessionReplayEnabled = useSetting('sessionReplayEnabled');
    const sessionReplayMaxSeedChars = useSetting('sessionReplayMaxSeedChars');
    const sessionReplayStrategy = useSetting('sessionReplayStrategy');
    const sessionReplaySummaryRunnerV1 = useSetting('sessionReplaySummaryRunnerV1');
    const sessionThinkingDisplayMode = useSetting('sessionThinkingDisplayMode');
    const sessionThinkingInlineChrome = useSetting('sessionThinkingInlineChrome');
    const sessionThinkingInlinePresentation = useSetting('sessionThinkingInlinePresentation');
    const toolViewTimelineChromeMode = useSetting('toolViewTimelineChromeMode');
    const transcriptMessageTimestampDisplayMode = useSetting('transcriptMessageTimestampDisplayMode');
    const transcriptMessageSelectionEnabled = useSetting('transcriptMessageSelectionEnabled');
    const transcriptMessageSendToSessionEnabled = useSetting('transcriptMessageSendToSessionEnabled');
    const transcriptStreamingMarkdownRenderingEnabled = useSetting('transcriptStreamingMarkdownRenderingEnabled');
    const transcriptStreamingPartialOutputEnabled = useSetting('transcriptStreamingPartialOutputEnabled');
    const transcriptStreamingSettleDelayMs = useSetting('transcriptStreamingSettleDelayMs');
    const transcriptStreamingSmoothingEnabled = useSetting('transcriptStreamingSmoothingEnabled');
    const transcriptToolCallsCollapsedPreviewCount = useSetting('transcriptToolCallsCollapsedPreviewCount');
    const transcriptToolCallsGroupShowBackground = useSetting('transcriptToolCallsGroupShowBackground');

    const fork = React.useMemo<TranscriptForkCommon>(() => ({
            agentSwitchingEnabled,
            executionRunsEnabled,
            sessionForkSupportSource,
            sessionReplayEnabled,
            sessionReplayMaxSeedChars,
            sessionReplayStrategy,
            sessionReplaySummaryRunnerV1,
        }), [
            agentSwitchingEnabled,
            executionRunsEnabled,
            sessionForkSupportSource,
            sessionReplayEnabled,
            sessionReplayMaxSeedChars,
            sessionReplayStrategy,
            sessionReplaySummaryRunnerV1,
        ]);

    const messageDisplay = React.useMemo<TranscriptMessageDisplayCommon>(() => ({
            debugInformationEnabled,
            sessionThinkingDisplayMode,
            sessionThinkingInlineChrome,
            sessionThinkingInlinePresentation,
            transcriptMessageTimestampDisplayMode,
            transcriptMessageSelectionEnabled,
            transcriptMessageSendToSessionEnabled,
            transcriptStreamingMarkdownRenderingEnabled,
            transcriptStreamingPartialOutputEnabled,
            transcriptStreamingSettleDelayMs,
            transcriptStreamingSmoothingEnabled,
            workspacePath,
        }), [
            debugInformationEnabled,
            sessionThinkingDisplayMode,
            sessionThinkingInlineChrome,
            sessionThinkingInlinePresentation,
            transcriptMessageTimestampDisplayMode,
            transcriptMessageSelectionEnabled,
            transcriptMessageSendToSessionEnabled,
            transcriptStreamingMarkdownRenderingEnabled,
            transcriptStreamingPartialOutputEnabled,
            transcriptStreamingSettleDelayMs,
            transcriptStreamingSmoothingEnabled,
            workspacePath,
        ]);

    // 只改变展示投影，不写入跨端设置；网页和平板继续使用原设置值。
    const toolChrome = React.useMemo<TranscriptToolChromeCommon>(() => ({
            compactToolCalls,
            toolViewTimelineChromeMode: compactToolCalls ? 'activity_feed' : toolViewTimelineChromeMode,
            transcriptToolCallsCollapsedPreviewCount: compactToolCalls ? 0 : transcriptToolCallsCollapsedPreviewCount,
            transcriptToolCallsGroupShowBackground: compactToolCalls ? false : transcriptToolCallsGroupShowBackground,
        }), [
            compactToolCalls,
            toolViewTimelineChromeMode,
            transcriptToolCallsCollapsedPreviewCount,
            transcriptToolCallsGroupShowBackground,
        ]);

    const toolRoute = React.useMemo<TranscriptToolRouteCommon>(() => ({
            messagesById,
            reducerState,
        }), [messagesById, reducerState]);

    return React.useMemo<TranscriptSessionCommon>(() => ({
        fork,
        messageDisplay,
        toolChrome,
        toolRoute,
    }), [fork, messageDisplay, toolChrome, toolRoute]);
}
