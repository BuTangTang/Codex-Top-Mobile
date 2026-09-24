import { RestoreQrView } from '@/components/account/restore/RestoreQrView';
import { UnauthenticatedSplitShell } from '@/components/onboarding/unauthShell';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

const ignoreBrandHeroGetStarted = () => undefined;

export default function ShowQrRoute() {
    const router = useRouter();

    return (
        <UnauthenticatedSplitShell
            stepId="restore-show-qr"
            isWelcomeStep={false}
            allowMobileBrandHero={false}
            onOpenRelayCustomFlow={() => router.push('/setup')}
            onBrandHeroGetStarted={ignoreBrandHeroGetStarted}
            onBack={() => router.back()}
            testID="unauth-shell-route-restore-show-qr"
        >
            <View testID="restore-route-content" style={{ flex: 1 }}>
                <RestoreQrView />
            </View>
        </UnauthenticatedSplitShell>
    );
}
