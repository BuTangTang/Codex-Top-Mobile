import type { ACPMessageData, ACPProvider } from '@/api/session/sessionMessageTypes';

import type {
    ObserveAcpLifecycleMarkerResult,
    SessionTurnLifecycleController,
} from './types';

export function observeAcpLifecycleMarker(input: Readonly<{
    lifecycle: SessionTurnLifecycleController;
    provider: ACPProvider;
    body: ACPMessageData;
}>): ObserveAcpLifecycleMarkerResult {
    return input.lifecycle.observeAcpLifecycleMarker({
        provider: input.provider,
        body: input.body,
    });
}
