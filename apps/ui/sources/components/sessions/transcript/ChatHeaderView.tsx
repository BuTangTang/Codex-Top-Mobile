import * as React from 'react';
import { View, Platform, Pressable, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { AgentIcon } from '@/agents/registry/AgentIcon';
import type { AgentId } from '@/agents/registry/registryCore';
import { useSetting } from '@/sync/domains/state/storage';
import { useLocalSetting } from '@/sync/store/hooks';
import { Typography } from '@/constants/Typography';
import { useHeaderHeight, useDeviceType } from '@/utils/platform/responsive';
import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { resolveOptionalSessionScreenTestId, useSessionScreenTestIdsEnabled } from '../shell/sessionScreenTestIds';
import { resolveChatHeaderContentInsets } from './chatHeaderLayout';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveSessionHeaderActionTargetPx } from '@/components/sessions/actions/sessionHeaderIconMetrics';


/** The gutter control's tap target, matching every other header action. */
const GUTTER_TAP_TARGET_PX = 44;

/** That tap target plus breathing room on both sides. */
const GUTTER_MIN_WIDTH_PX = 60;

/** The header's own horizontal inset — the margin every other control in it is measured from. */
const HEADER_HORIZONTAL_PADDING_PX = Platform.OS === 'ios' ? 8 : 16;
const PHONE_STATUS_TITLE_LINE_HEIGHT = 24;

interface ChatHeaderViewProps {
    title: string;
    subtitle?: string;
    /** 手机桌面会话使用固定状态行，取代会随错误详情增高的底部状态区。 */
    statusElement?: React.ReactNode;
    subtitleEllipsizeMode?: 'head' | 'tail';
    badges?: ReadonlyArray<string>;
    onBackPress?: () => void;
    avatarId?: string;
    /** Resolved agent for this session, when there is one. Shown in place of the avatar on request. */
    agentId?: AgentId | null;
    rightElement?: React.ReactNode;
    backgroundColor?: string;
    tintColor?: string;
    isConnected?: boolean;
    flavor?: string | null;
    constrainWidth?: boolean;
    /** Space reserved beside the transcript, without moving the trailing header actions. */
    contentTrailingInsetPx?: number;
    includeTopInset?: boolean;
    /**
     * Defaults to shown. Suppressed where a permanent sidebar is on screen: there is no stack to
     * pop back to, so the chevron is a control that does nothing but take the first slot in the
     * header. The share viewer has no sidebar and keeps it.
     */
    showBackButton?: boolean;
    /**
     * Rendered in the empty margin beside the width-constrained content when that margin is wide
     * enough to hold it, and appended to the trailing icons when it is not. For a control that acts
     * on something at the screen's edge — the right sidebar — sitting at that edge is what says so.
     */
    gutterElement?: React.ReactNode;
}

/** 展示真实标题与来源；手机状态入口独立占固定行，不随生命周期变化挤动正文。 */
export const ChatHeaderView = React.memo(function ChatHeaderView({
    title,
    subtitle,
    statusElement,
    subtitleEllipsizeMode = 'tail',
    badges,
    onBackPress,
    avatarId,
    agentId,
    rightElement,
    isConnected = true,
    flavor,
    constrainWidth = true,
    contentTrailingInsetPx = 0,
    includeTopInset = true,
    showBackButton = true,
    gutterElement,
}: ChatHeaderViewProps): React.ReactElement {
    const { theme } = useUnistyles();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    // 手机标题保留真实会话和电脑上下文，省去装饰头像占用。
    const isPhone = useDeviceType() === 'phone' && Platform.OS !== 'web';
    const uiFontScale = useLocalSetting('uiFontScale');
    const { fontScale = 1 } = useWindowDimensions();
    // 只按字体设置决定整行高度，容纳真实缩放后的文字、留白和按钮；状态变化不参与计算。
    const titleRowHeight = isPhone && statusElement
        ? Math.max(resolveSessionHeaderActionTargetPx(), Math.ceil(PHONE_STATUS_TITLE_LINE_HEIGHT * uiFontScale * fontScale) + 12)
        : headerHeight;
    const maxWidth = useLayoutMaxWidth();
    const sessionScreenTestIdsEnabled = useSessionScreenTestIdsEnabled();
    const backButtonTestId = resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-header-back');
    const avatarButtonTestId = resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-header-avatar');
    const shouldUseWebSubtitleStartEllipsis = subtitleEllipsizeMode === 'head' && Platform.OS === 'web';
    const identityMode = useSetting('sessionHeaderIdentityDisplay');

    // The header content is centred and width-capped, so on a wide window there is an empty margin
    // on each side. Measure the trailing one: if it can hold a 44pt control with air around it, the
    // gutter element goes there; otherwise it falls back into the icon row.
    const [wrapperWidth, setWrapperWidth] = React.useState(0);
    /** 记录宽度，保留大屏边栏控制与正文的原有对齐。 */
    const handleWrapperLayout = React.useCallback((event: LayoutChangeEvent) => {
        setWrapperWidth(event.nativeEvent.layout.width);
    }, []);
    const contentInsets = resolveChatHeaderContentInsets({
        containerWidth: wrapperWidth,
        maxWidth,
        contentTrailingInsetPx,
        constrainWidth,
    });
    const trailingGutterWidth = contentInsets.trailing;
    const gutterHoldsElement = gutterElement != null && trailingGutterWidth >= GUTTER_MIN_WIDTH_PX;
    // Half the leftover once the tap target is centred in `headerHeight` — which is also the gap the
    // control leaves above itself. Using it horizontally makes the icon's distance to the window's
    // top and right edges identical (this inset plus the icon's own centring inside the tap target),
    // so the control reads as sitting in the corner rather than pinned to one side of it. Raising it
    // to the header's content padding looks like more breathing room but breaks that symmetry.
    const cornerInset = Math.max(0, (headerHeight - GUTTER_TAP_TARGET_PX) / 2);
    // Which identity leads the header is the user's call. `agent` with no resolvable agent renders
    // nothing rather than silently falling back to the avatar — that would answer a question the
    // user already answered.
    // 手机省略装饰头像，大屏继续尊重原身份显示设置。
    /** 手机省略装饰身份图，大屏继续使用已有身份偏好。 */
    const leadingIdentity = React.useMemo(() => {
        if (isPhone || identityMode === 'none') return null;
        if (identityMode === 'agentLogo') {
            return agentId ? <AgentIcon agentId={agentId} size={26} /> : null;
        }
        return avatarId
            ? <Avatar id={avatarId} size={32} monochrome={!isConnected} flavor={flavor} />
            : null;
    }, [agentId, avatarId, flavor, identityMode, isConnected, isPhone]);

    /** 返回原导航层，保留调用方提供的会话来源路径。 */
    const handleBackPress = () => {
        if (onBackPress) {
            onBackPress();
        } else {
            navigation.goBack();
        }
    };

    return (
        <View style={[styles.container, isPhone ? styles.phoneContainer : null, { paddingTop: includeTopInset ? insets.top : 0, backgroundColor: theme.colors.chrome.header.background }]}>
            <View
                onLayout={handleWrapperLayout}
                style={[styles.contentWrapper, constrainWidth ? null : { alignItems: 'stretch' }]}
            >
                <View style={[
                    styles.content,
                    { minHeight: titleRowHeight, height: isPhone && !statusElement ? undefined : titleRowHeight, maxWidth },
                    constrainWidth ? null : { maxWidth: '100%' },
                    wrapperWidth > 0 && contentTrailingInsetPx > 0 && constrainWidth ? {
                        alignSelf: 'flex-start',
                        marginLeft: contentInsets.leading,
                        width: wrapperWidth - contentInsets.leading - contentInsets.trailing,
                        maxWidth: '100%',
                    } : null,
                ]}>
                {showBackButton ? (
                    <Pressable
                        onPress={handleBackPress}
                        testID={backButtonTestId}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.back')}
                        style={[styles.backButton, isPhone ? styles.phoneBackButton : null, {
                            width: resolveSessionHeaderActionTargetPx(),
                            height: resolveSessionHeaderActionTargetPx(),
                            alignItems: 'center',
                            justifyContent: 'center',
                        }]}
                    >
                        <Icon
                            name={Platform.OS === 'ios' ? 'caret-left' : 'arrow-left'}
                            size={Platform.select({ ios: 28, default: 24 })}
                            color={theme.colors.chrome.header.foreground}
                        />
                    </Pressable>
                ) : null}

                {leadingIdentity ? (
                    <View style={styles.avatarLeading} testID={avatarButtonTestId}>
                        {leadingIdentity}
                    </View>
                ) : null}

                <View style={[styles.titleContainer, isPhone ? styles.phoneTitleContainer : null]}>
                    <View style={[styles.titleRow, isPhone ? styles.phoneTitleRow : null]}>
                        <Text
                            numberOfLines={isPhone && !statusElement ? 2 : 1}
                            ellipsizeMode="tail"
                            accessibilityLabel={title}
                            style={[
                                styles.title,
                                isPhone ? styles.phoneTitle : null,
                                isPhone && statusElement ? styles.phoneStatusTitle : null,
                                {
                                    color: theme.colors.chrome.header.foreground,
                                    ...Typography.default('semiBold')
                                }
                            ]}
                        >
                            {title}
                        </Text>
                        {badges && badges.length > 0 ? (
                            badges.map((badge, index) => (
                                <View
                                    key={`${badge}:${index}`}
                                    style={[
                                        styles.badge,
                                        { backgroundColor: theme.colors.state.neutral.background },
                                    ]}
                                    testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, `session-header-badge:${index}`)}
                                >
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.badgeText,
                                            {
                                                color: theme.colors.state.neutral.foreground,
                                                ...Typography.default('semiBold'),
                                            },
                                        ]}
                                    >
                                        {badge}
                                    </Text>
                                </View>
                            ))
                        ) : null}
                    </View>
                    {!statusElement && subtitle && (
                        <Text
                            numberOfLines={1}
                            accessibilityLabel={subtitle}
                            ellipsizeMode={shouldUseWebSubtitleStartEllipsis ? undefined : subtitleEllipsizeMode}
                            style={[
                                styles.subtitle,
                                isPhone ? styles.phoneSubtitle : null,
                                shouldUseWebSubtitleStartEllipsis ? styles.subtitleHeadWeb : null,
                                {
                                    color: theme.colors.text.secondary,
                                    ...Typography.default()
                                }
                            ]}
                        >
                            {shouldUseWebSubtitleStartEllipsis ? (
                                <Text style={styles.subtitleHeadTextWeb}>
                                    {subtitle}
                                </Text>
                            ) : subtitle}
                        </Text>
                    )}
                </View>

                {rightElement ? (
                    <View style={styles.rightElementContainer}>
                        {rightElement}
                    </View>
                ) : null}

                {gutterHoldsElement ? null : gutterElement}
                </View>
                {statusElement ? <View style={{ width: '100%', maxWidth }}>{statusElement}</View> : null}
                {gutterHoldsElement ? (
                    <View
                        pointerEvents="box-none"
                        // `top: 0` is the wrapper's own origin, which already sits below the
                        // container's safe-area padding — adding the inset here would count it twice.
                        style={[
                            styles.trailingGutter,
                            {
                                width: trailingGutterWidth,
                                height: headerHeight,
                                top: 0,
                                // Equal to the gap the centred tap target already leaves above
                                // itself, so the corner reads as a corner.
                                paddingRight: cornerInset,
                            },
                        ]}
                    >
                        {gutterElement}
                    </View>
                ) : null}
            </View>
        </View>
    );
});

/** 会话标题使用平面分隔；字号仍由应用文字缩放控制。 */
const styles = StyleSheet.create((theme) => ({
    container: {
        position: 'relative',
        zIndex: 100,
        elevation: 10,
    },
    contentWrapper: {
        width: '100%',
        alignItems: 'center',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: HEADER_HORIZONTAL_PADDING_PX,
        width: '100%',
    },
    backButton: {
        marginRight: 8,
    },
    avatarLeading: {
        marginRight: 10,
    },
    trailingGutter: {
        position: 'absolute',
        right: 0,
        // Right-aligned so the control sits in the window corner instead of floating mid-margin,
        // and vertically centred so it lands on the same line as the header icons — both are
        // centred in the same `headerHeight`, so they agree without a hand-tuned offset.
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    phoneContainer: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.default,
        elevation: 0,
    },
    phoneBackButton: { marginRight: 0 },
    phoneTitleContainer: { alignItems: 'center', paddingVertical: 6 },
    phoneTitleRow: { justifyContent: 'center' },
    phoneTitle: { textAlign: 'center', fontSize: 16 },
    phoneStatusTitle: { lineHeight: PHONE_STATUS_TITLE_LINE_HEIGHT },
    phoneSubtitle: { textAlign: 'center', lineHeight: 16 },
    titleContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'flex-start',
        minWidth: 0,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        width: '100%',
    },
    title: {
        fontSize: Platform.select({
            ios: 15,
            android: 15,
            default: 16
        }),
        fontWeight: '600',
        flexShrink: 1,
    },
    subtitle: {
        fontSize: 12,
        fontWeight: '400',
        lineHeight: 14,
        marginTop: 1,
    },
    subtitleHeadWeb: {
        writingDirection: 'rtl' as const,
        textAlign: 'left' as const,
    },
    subtitleHeadTextWeb: {
        writingDirection: 'ltr' as const,
        unicodeBidi: 'isolate' as const,
    },
    // Matches the canonical badge (components/ui/status/StatusPill): background-only, no border
    // chrome, 8px radius. A bordered capsule in the header read as a different species from every
    // other badge in the product.
    badge: {
        borderWidth: 0,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    badgeText: {
        fontSize: 10,
        lineHeight: 14,
    },
    rightElementContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
}));
