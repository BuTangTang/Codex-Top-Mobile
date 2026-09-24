import { canonicalizeServerUrl, createServerUrlComparableKey } from './serverUrlCanonical';
import { isLoopbackServerUrl } from './serverUrlClassification';

/**
 * Cross-device QR/deep-link policy:
 * - If a link tries to override the server to a loopback-only URL (localhost/127.0.0.1/etc),
 *   ignore that override when we already have a non-loopback active server.
 *
 * This prevents mobile devices from being "switched" to an unreachable `localhost` server
 * after scanning a QR code produced on a different machine.
 */
export function resolveEffectiveServerUrlOverride(params: Readonly<{
    requestedServerUrl: string | null | undefined;
    activeServerUrl: string | null | undefined;
    equivalentActiveServerUrls?: readonly (string | null | undefined)[];
    allowLoopbackSwitch?: boolean;
}>): string | null {
    const allowLoopbackSwitch = params.allowLoopbackSwitch ?? false;
    const requested = canonicalizeServerUrl(String(params.requestedServerUrl ?? ''));
    if (!requested) return null;

    const requestedKey = createServerUrlComparableKey(requested);
    if (!requestedKey) return null;

    const active = canonicalizeServerUrl(String(params.activeServerUrl ?? ''));
    if (!active) return requested;

    const activeKey = createServerUrlComparableKey(active);
    if (!activeKey) return requested;
    if (requestedKey === activeKey) return null;

    for (const equivalentUrl of params.equivalentActiveServerUrls ?? []) {
        const equivalent = canonicalizeServerUrl(String(equivalentUrl ?? ''));
        if (!equivalent) continue;
        if (requestedKey === createServerUrlComparableKey(equivalent)) return null;
    }

    // Loopback targets are only safe when they resolve to the same active server unless
    // the caller explicitly opts into a terminal-connect style switch.
    if (!allowLoopbackSwitch && isLoopbackServerUrl(requested) && requestedKey !== activeKey) {
        return null;
    }
    return requested;
}
