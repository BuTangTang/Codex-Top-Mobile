import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { UnauthenticatedSplitShell } from '@/components/onboarding/unauthShell';

const noop = () => {};

export type TerminalConnectRouteShellProps = Readonly<{
    children: React.ReactNode;
    enabled: boolean;
    stepId: 'terminal' | 'terminal-connect';
    testID: string;
    contentTestID: string;
    onBack?: () => void;
    onOpenRelayCustomFlow: () => void;
}>;

export function TerminalConnectRouteShell(props: TerminalConnectRouteShellProps) {
    const styles = stylesheet;
    const content = (
        <View testID={props.contentTestID} style={styles.content}>
            {props.children}
        </View>
    );

    if (!props.enabled) {
        return content;
    }

    return (
        <UnauthenticatedSplitShell
            stepId={props.stepId}
            isWelcomeStep={false}
            allowMobileBrandHero={false}
            onOpenRelayCustomFlow={props.onOpenRelayCustomFlow}
            onBrandHeroGetStarted={noop}
            onBack={props.onBack}
            testID={props.testID}
        >
            {content}
        </UnauthenticatedSplitShell>
    );
}

const stylesheet = StyleSheet.create(() => ({
    content: {
        flex: 1,
        minHeight: 0,
        width: '100%',
    },
}));
