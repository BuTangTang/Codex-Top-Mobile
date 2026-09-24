import { useSessionAgentActivity } from '@/hooks/session/useSessionAgentActivity';
import type { UseDirectSessionRuntimeResult } from '@/components/sessions/model/useDirectSessionRuntime';

// Counts do not need controllability. Avoid attaching another direct-session poll merely for chrome.
const COUNT_ONLY_DIRECT_SESSION_RUNTIME: UseDirectSessionRuntimeResult = Object.freeze({
    control: null,
    directSessionLink: null,
    status: null,
    refreshNow: async () => null,
    notificationsBusy: false,
    setNotificationsEnabled: async () => null,
});

export function useSessionRunningAgentCount(sessionId: string): number {
    return useSessionAgentActivity({ sessionId, directSessionRuntime: COUNT_ONLY_DIRECT_SESSION_RUNTIME }).counts.live;
}
