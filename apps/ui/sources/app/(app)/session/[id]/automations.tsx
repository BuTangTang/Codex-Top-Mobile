import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { AutomationsGate } from '@/components/automations/gating/AutomationsGate';
import { SessionAutomationsScreen } from '@/components/automations/screens/SessionAutomationsScreen';
import { useSessionRouteServerScope } from '@/hooks/session/sessionRouteServerScope';

export default function SessionAutomationsRoute() {
    const params = useLocalSearchParams<{ id?: string; serverId?: string }>();
    const routeScope = useSessionRouteServerScope(params);
    const sessionId = typeof params.id === 'string' ? params.id : '';
    return (
        <AutomationsGate>
            <SessionAutomationsScreen
                sessionId={sessionId}
                hydrationOptions={routeScope.hydrationOptions}
            />
        </AutomationsGate>
    );
}
