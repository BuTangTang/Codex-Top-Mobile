import * as React from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';

import { isRunningOnMac } from '@/utils/platform/platform';
import { RestoreQrView } from '@/components/account/restore/RestoreQrView';
import { RestoreScanComputerQrView } from '@/components/account/restore/RestoreScanComputerQrView';
import { isWebQrScannerSupported } from '@/utils/platform/qrScannerSupport';
import { isWebMobileLikeQrScannerHost } from '@/utils/platform/webMobileHeuristics';
import { UnauthenticatedSplitShell } from '@/components/onboarding/unauthShell';
import { useAuth } from '@/auth/context/AuthContext';

const ignoreBrandHeroGetStarted = () => undefined;

export default function RestoreIndex() {
    const auth = useAuth();
    const router = useRouter();
    const { width, height } = useWindowDimensions();
    const isNativePhone = (Platform.OS === 'ios' || Platform.OS === 'android') && !isRunningOnMac();
    const isWebPhoneWithCamera =
        Platform.OS === 'web' && isWebQrScannerSupported() && isWebMobileLikeQrScannerHost({ width, height });
    const showScannerFirst = isNativePhone || isWebPhoneWithCamera;

    const content = (
        <View testID="restore-route-content" style={{ flex: 1 }}>
            {showScannerFirst ? <RestoreScanComputerQrView /> : <RestoreQrView />}
        </View>
    );

    if (auth.isAuthenticated) {
        return content;
    }

    return (
        <UnauthenticatedSplitShell
            stepId="restore"
            isWelcomeStep={false}
            allowMobileBrandHero={false}
            onOpenRelayCustomFlow={() => router.push('/setup')}
            onBrandHeroGetStarted={ignoreBrandHeroGetStarted}
            onBack={showScannerFirst ? undefined : () => router.back()}
            workflowPresentation={showScannerFirst ? 'fullBleed' : 'padded'}
            testID="unauth-shell-route-restore"
        >
            {content}
        </UnauthenticatedSplitShell>
    );
}
