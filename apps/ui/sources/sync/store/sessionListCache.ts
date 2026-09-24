import { getActiveServerSnapshot } from '../domains/server/serverRuntime';
import type { SessionListViewItem } from '../domains/session/listing/sessionListViewData';

export function setServerSessionListCache(
    current: Record<string, SessionListViewItem[] | null>,
    serverIdRaw: string,
    sessionListViewData: SessionListViewItem[] | null,
): Record<string, SessionListViewItem[] | null> {
    const serverId = String(serverIdRaw ?? '').trim();
    if (!serverId) {
        return current;
    }
    return {
        ...current,
        [serverId]: sessionListViewData,
    };
}

export function setActiveServerSessionListCache(
    current: Record<string, SessionListViewItem[] | null>,
    sessionListViewData: SessionListViewItem[] | null,
): Record<string, SessionListViewItem[] | null> {
    const activeServerId = getActiveServerIdForSessionListCache();
    return setServerSessionListCache(current, activeServerId, sessionListViewData);
}

export function getActiveServerIdForSessionListCache(): string {
    return String(getActiveServerSnapshot().serverId ?? '').trim();
}
