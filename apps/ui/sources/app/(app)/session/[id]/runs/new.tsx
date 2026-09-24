import * as React from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { Text } from '@/components/ui/text/Text';
import { SessionExecutionRunLauncherView } from '@/components/sessions/runs/launcher/SessionExecutionRunLauncherView';
import { SessionInvalidLinkFallback } from '@/components/sessions/shell/SessionInvalidLinkFallback';
import { resolveExecutionRunLauncherIntent } from '@/components/sessions/runs/launcher/executionRunLauncherModel';
import { useSessionRouteServerScope } from '@/hooks/session/sessionRouteServerScope';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { isSessionRouteHydrationAvailable, isSessionRouteHydrationMissing } from '@/sync/domains/session/sessionRouteHydrationState';
import { t } from '@/text';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';

function normalizeSessionId(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) return value[0].trim();
    return null;
}

export default function SessionNewRunScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const params = useLocalSearchParams();
    const routeScope = useSessionRouteServerScope(params as Record<string, unknown>);
    const sessionId = normalizeSessionId((params as any)?.id);
    const routeHydrationState = useHydrateSessionForRoute(
        sessionId ?? '',
        'SessionNewRunScreen.hydrate',
        routeScope.hydrationOptions,
    );
    const hydrateReady = isSessionRouteHydrationAvailable(routeHydrationState);
    const hydrateMissing = isSessionRouteHydrationMissing(routeHydrationState);
    const rawIntent = (params as any)?.intent;
    const hasIntentParam = rawIntent !== undefined;
    const initialIntent = resolveExecutionRunLauncherIntent(rawIntent);
    const launcherIntent = initialIntent ?? 'review';
    const parentSessionHref = sessionId ? routeScope.buildHref(sessionId) : '/session';

    const screenOptions = React.useMemo(() => ({
        headerShown: true,
        headerTitle: t('executionRuns.newRun.headerTitle'),
        headerBackTitle: t('common.back'),
    }), []);
    const handleRequestClose = React.useCallback(() => {
        safeRouterBack({
            router,
            navigation,
            fallbackHref: parentSessionHref,
        });
    }, [navigation, parentSessionHref, router]);

    if (hasIntentParam && initialIntent === null) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.background?.canvas ?? theme.colors.surface.base }}>
                <Stack.Screen options={screenOptions} />
                <ConstrainedScreenContent
                    style={{
                        flex: 1,
                        paddingHorizontal: 16,
                        paddingVertical: 16,
                        gap: 16,
                    }}
                >
                    <Text style={{ color: theme.colors.text.secondary }}>{t('errors.invalidFormat')}</Text>
                </ConstrainedScreenContent>
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background?.canvas ?? theme.colors.surface.base }}>
            <Stack.Screen options={screenOptions} />
            <ConstrainedScreenContent
                style={{
                    flex: 1,
                    paddingHorizontal: 16,
                    paddingVertical: 16,
                    gap: 16,
                }}
            >
                {!sessionId || hydrateMissing ? (
                    <SessionInvalidLinkFallback />
                ) : !hydrateReady ? (
                    <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                ) : (
                    <SessionExecutionRunLauncherView
                        sessionId={sessionId}
                        routeHydrationState={routeHydrationState}
                        initialIntent={launcherIntent}
                        presentation="screen"
                        onRequestClose={handleRequestClose}
                    />
                )}
            </ConstrainedScreenContent>
        </View>
    );
}
