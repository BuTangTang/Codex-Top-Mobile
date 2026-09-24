import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { bootstrapActiveServerFromWebLocation, readWebServerUrlOverrideFromLocation } from '@/sync/domains/server/url/bootstrapActiveServerFromWebLocation';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';

export async function resolveBootCredentials(platformOs: string): Promise<AuthCredentials | null> {
    const webServerOverride = platformOs === 'web'
        ? (bootstrapActiveServerFromWebLocation({ scope: 'device' }) ?? readWebServerUrlOverrideFromLocation())
        : null;
    const activeServerSnapshot = getActiveServerSnapshot();
    const activeServerComparableKey = createServerUrlComparableKey(activeServerSnapshot.serverUrl);
    const overrideComparableKey = createServerUrlComparableKey(webServerOverride?.serverUrl ?? '');
    const serverLookupOptions =
        overrideComparableKey
        && activeServerComparableKey
        && overrideComparableKey === activeServerComparableKey
        && activeServerSnapshot.serverId
            ? { serverId: activeServerSnapshot.serverId }
            : undefined;
    return webServerOverride?.serverUrl
        ? await TokenStorage.getCredentialsForServerUrl(webServerOverride.serverUrl, serverLookupOptions)
        : await TokenStorage.getCredentials();
}
