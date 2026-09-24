import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { AutomationsGate } from '@/components/automations/gating/AutomationsGate';
import { SessionAutomationCreateScreen } from '@/components/automations/screens/SessionAutomationCreateScreen';
import { useSessionRouteServerScope } from '@/hooks/session/sessionRouteServerScope';

export default function SessionAutomationCreateRoute() {
    const params = useLocalSearchParams<{ id?: string; serverId?: string }>();
    const routeScope = useSessionRouteServerScope(params);
    const sessionId = typeof params.id === 'string' ? params.id : '';
    return (
        <AutomationsGate>
            <SessionAutomationCreateScreen
                sessionId={sessionId}
                hydrationOptions={routeScope.hydrationOptions}
            />
        </AutomationsGate>
    );
}
