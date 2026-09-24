import * as React from 'react';
import { View, ViewStyle, Platform } from 'react-native';
import { useDeviceType } from '@/utils/platform/responsive';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { ITEM_SUBTITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { t } from '@/text';
import { ConversationNotice } from './ConversationNotice';
import { ComposerAuxiliaryFrame } from '@/components/sessions/shell/view/ComposerAuxiliaryFrame';
import { SessionWarningActionBanner } from '@/components/sessions/shell/SessionWarningActionBanner';
import type { SessionLocalControlState } from '@/sync/domains/session/control/sessionLocalControl';
import type { DirectSessionStatusGetResponse } from '@happier-dev/protocol';
import { resolveDirectSessionControlNotice } from '@/components/sessions/directSessions/resolveDirectSessionControlNotice';

export type ChatFooterDirectControlState = Readonly<{
    machineOnline: boolean;
    runnerActive: boolean;
    activity: 'running' | 'active_recently' | 'idle' | 'unknown';
    canTakeOverDirect: boolean;
    canTakeOverPersist: boolean;
    takeoverInFlight: 'direct' | 'persisted' | null;
    externalControl?: Extract<DirectSessionStatusGetResponse, { ok: true }>['externalControl'];
    inheritsDesktopSettings?: boolean;
    onRequestTakeOverDirect?: () => void | Promise<void>;
    onRequestTakeOverPersist?: () => void | Promise<void>;
}> | null;

type ChatFooterNotice = Readonly<{ title: string; body: string }>;

interface ChatFooterProps {
    controlledByUser?: boolean;
    localControl?: SessionLocalControlState | null;
    permissionsInUiWhileLocal?: boolean;
    notice?: ChatFooterNotice | null;
    /**
     * UI-only ephemeral state while a local-controlled session is switching back to remote.
     * This is intentionally not persisted to the session transcript.
    */
    controlSwitchTo?: 'remote' | null;
    onRequestSwitchToRemote?: () => void;
    directControl?: ChatFooterDirectControlState;
}

/** 展示会话页脚的桌面文本能力与接管进度；接管动作统一放在页头更多菜单。 */
export const ChatFooter = React.memo((props: ChatFooterProps) => {
    const compactPhone = useDeviceType() === 'phone' && Platform.OS !== 'web';
    const { theme } = useUnistyles();
    const containerStyle: ViewStyle = {
        // Allow children to take full width so long banners can wrap instead of overflowing
        alignItems: 'stretch',
        paddingTop: 4,
        paddingBottom: 2,
    };

    /** 本地控制提示继续使用原控制能力及切换回调。 */
    const localControlBanner = React.useMemo(() => {
        const localControl = props.localControl ?? null;
        if (!localControl && !props.controlledByUser) return null;

        const derived = localControl ?? {
            attached: props.controlledByUser === true,
            topology: 'exclusive',
            remoteWritable: false,
            canAttach: false,
            canDetach: props.controlledByUser === true,
        } satisfies SessionLocalControlState;

        const switchingToRemote = props.controlSwitchTo === 'remote';
        if (!derived.attached) return null;

        const isSharedAttached = derived.attached && derived.topology === 'shared';
        const showSwitchToRemoteButton =
            derived.attached
            && derived.topology === 'exclusive'
            && !switchingToRemote
            && Boolean(props.onRequestSwitchToRemote);
        const showDetachButton =
            derived.attached
            && derived.topology === 'shared'
            && !switchingToRemote
            && derived.canDetach
            && Boolean(props.onRequestSwitchToRemote);
        if (derived.remoteWritable && !switchingToRemote && !showSwitchToRemoteButton && !showDetachButton) {
            return null;
        }
        const textKey = (() => {
            if (switchingToRemote) return 'chatFooter.switchingToRemote';
            if (isSharedAttached) return 'chatFooter.sessionRunningLocallyAndRemotely';
            if (props.permissionsInUiWhileLocal) return 'chatFooter.sessionRunningLocally';
            return 'chatFooter.permissionsTerminalOnly';
        })();

        const actionLabelKey = showSwitchToRemoteButton
            ? 'chatFooter.switchToRemote'
            : showDetachButton
                ? 'chatFooter.detachLocalTerminal'
                : null;
        const actionTestID = showSwitchToRemoteButton
            ? 'session-chatFooter-switchToRemote'
            : showDetachButton
                ? 'session-chatFooter-detachLocalTerminal'
                : undefined;

        return (
            <ComposerAuxiliaryFrame>
                <SessionWarningActionBanner
                    testID="session-chatFooter-localControl"
                    iconName="info"
                    body={t(textKey)}
                    actionTestID={actionTestID}
                    actionLabel={actionLabelKey ? t(actionLabelKey) : undefined}
                    actionAccessibilityLabel={actionLabelKey ? t(actionLabelKey) : undefined}
                    onActionPress={actionLabelKey ? props.onRequestSwitchToRemote : undefined}
                />
            </ComposerAuxiliaryFrame>
        );
    }, [
        props.controlSwitchTo,
        props.controlledByUser,
        props.localControl,
        props.onRequestSwitchToRemote,
        props.permissionsInUiWhileLocal,
    ]);

    /** 无活动 runner 时保留异常和接管进度；正常可发消息不重复占用正文空间。 */
    const directModeBanner = React.useMemo(() => {
        if (!props.directControl) return null;
        if (props.directControl.runnerActive) return null;

        const switchingToDirect = props.directControl.takeoverInFlight === 'direct';
        const switchingToPersisted = props.directControl.takeoverInFlight === 'persisted';
        // 桌面文本能力与用户明确选择的接管分开说明，未知状态不宣称可用。
        const body = (() => {
            if (switchingToPersisted) return t('chatFooter.switchingToPersistedTakeover');
            if (switchingToDirect) return t('chatFooter.switchingToDirectTakeover');
            return resolveDirectSessionControlNotice(props.directControl, props.directControl.inheritsDesktopSettings === true);
        })();

        // 只有当前明确在线、可发送且未接管时才省略提示，未知和离线仍显示。
        if (props.directControl.inheritsDesktopSettings === true
            && props.directControl.machineOnline
            && props.directControl.externalControl?.canSend === true
            && !props.directControl.takeoverInFlight) {
            if (compactPhone) return null;
            return (
                <ComposerAuxiliaryFrame>
                    <Text testID="session-chatFooter-directControl-ready"
                        style={{ ...ITEM_SUBTITLE_TEXT_METRICS.compact, color: theme.colors.text.secondary }}>
                        {body}
                    </Text>
                </ComposerAuxiliaryFrame>
            );
        }

        return (
            <ComposerAuxiliaryFrame>
                {compactPhone
                    ? <ConversationNotice testID="session-chatFooter-directControl" body={body} />
                    : <SessionWarningActionBanner testID="session-chatFooter-directControl" iconName="info" body={body} />}
            </ComposerAuxiliaryFrame>
        );
    }, [compactPhone, props.directControl, theme.colors.text.secondary]);

    return (
        <View style={containerStyle}>
            {directModeBanner}
            {localControlBanner}
            {props.notice ? (
                <ComposerAuxiliaryFrame>
                    <SessionWarningActionBanner
                        testID="session-chatFooter-notice"
                        tone="neutral"
                        iconName={null}
                        title={props.notice.title}
                        body={props.notice.body}
                    />
                </ComposerAuxiliaryFrame>
            ) : null}
        </View>
    );
});
