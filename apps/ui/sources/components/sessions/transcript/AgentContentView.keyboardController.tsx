import { useDeviceType, useHeaderHeight } from '@/utils/platform/responsive';
import { ComposerKeyboardScaffold } from '@/components/sessions/keyboardAvoidance';
import { isMobileWorkspaceExperienceLockedToClassic } from '@/components/workspaceCockpit/mobileWorkspaceExperience';
import { useSessionCockpitBottomChromeHeight } from '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry';
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { useKeyboardDismissOnTap } from './useKeyboardDismissOnTap';

interface AgentContentViewProps {
    input?: React.ReactNode | null;
    content?: React.ReactNode | null;
    placeholder?: React.ReactNode | null;
    safeAreaBottom?: number;
}

/** 统一原生会话的内容、输入区与键盘布局，并沿用设备的有效底栏策略。 */
export const AgentContentView: React.FC<AgentContentViewProps> = React.memo(({
    input,
    content,
    placeholder,
    safeAreaBottom,
}) => {
    const safeArea = useSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const deviceType = useDeviceType();
    const measuredBottomChromeHeight = useSessionCockpitBottomChromeHeight();
    // 原生手机会话不显示工作台底栏；导航期间注册表可能仍保留上一页的测量高度。
    const bottomChromeHeight = isMobileWorkspaceExperienceLockedToClassic({ deviceType })
        ? 0
        : measuredBottomChromeHeight;
    const keyboardDismissOnTapHandlers = useKeyboardDismissOnTap();
    const { theme } = useUnistyles();

    // Reserve the floating bar's height *inside the session screen* (not the global
    // chrome host) so the composer/transcript sit above the overlay bar AND this
    // reserved area slides away with the session on dismiss — the window canvas
    // behind the bar is never exposed as a lingering bottom band. `bottomChromeHeight`
    // is 0 when the bar is hidden (e.g. keyboard open), collapsing the reservation
    // so the scaffold geometry is identical to having no bar.
    return (
        <View style={{ flex: 1, minHeight: 0, paddingBottom: bottomChromeHeight, backgroundColor: theme.colors.surface.base }}>
            <ComposerKeyboardScaffold
                testID="agent-content-keyboard-host"
                mode="session"
                contentTestID="agent-content-scroll-region"
                composerTestID="agent-content-input-footer"
                layoutBottomInset={bottomChromeHeight}
                safeAreaBottom={safeAreaBottom ?? safeArea.bottom}
                headerHeight={headerHeight}
                contentProps={keyboardDismissOnTapHandlers}
                composer={input}
            >
                {content ? (
                    <View style={{ flex: 1, minHeight: 0 }}>
                        {content}
                    </View>
                ) : null}
                {placeholder ? (
                    <ScrollView
                        style={{ position: 'absolute', top: safeArea.top + headerHeight, left: 0, right: 0, bottom: 0 }}
                        contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}
                        keyboardShouldPersistTaps="handled"
                        alwaysBounceVertical={false}
                    >
                        {placeholder}
                    </ScrollView>
                ) : null}
            </ComposerKeyboardScaffold>
        </View>
    );
});
