import { useAppPaneContext } from '../AppPaneProvider';

/**
 * Number of open detail tabs for a pane scope (e.g. `session:<id>`).
 *
 * Must be used within an `AppPaneProvider`; the cockpit chrome bridge reads this
 * from inside the session subtree and publishes it up to the global bottom chrome
 * so the cockpit "Tabs" tab can show an open-tab count.
 */
export function useDetailsTabCount(scopeId: string): number {
    const { state } = useAppPaneContext();
    return state.scopes[scopeId]?.details?.tabs.length ?? 0;
}
