import { resolveAppUrlScheme } from '@/utils/url/appScheme';
import { parseHappierCustomSchemeUrl } from '@/utils/url/parseHappierCustomSchemeUrl';

type PairingDeepLinkPayload = {
    pairId: string;
    secret: string;
    serverUrl: string | null;
};

function isValidPairingLinkTarget(hostname: string, pathname: string): boolean {
    const normalizedPathname = pathname === 'pair' ? '/pair' : pathname;

    if (normalizedPathname === '/pair') return true;
    if (hostname === 'pair' && (normalizedPathname === '' || normalizedPathname === '/')) return true;

    return false;
}

function normalizeServerUrl(raw: string): string | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;

    const pathname = url.pathname === '/' ? '' : url.pathname;
    const search = url.search ?? '';
    return `${url.origin}${pathname}${search}`;
}

export function parsePairingDeepLink(rawLink: string): PairingDeepLinkPayload | null {
    const parsed = parseHappierCustomSchemeUrl(rawLink);
    if (!parsed) return null;
    if (!isValidPairingLinkTarget(parsed.hostname, parsed.pathname)) return null;

    const version = parsed.searchParams.get('v');
    if (version != null && version !== '1') return null;

    const pairId = parsed.searchParams.get('pairId');
    const secret = parsed.searchParams.get('secret');
    if (!pairId || !secret) return null;

    const server = parsed.searchParams.get('server');
    const serverUrl = server ? normalizeServerUrl(server) : null;

    return { pairId, secret, serverUrl };
}

export function buildPairingDeepLink(input: { pairId: string; secret: string; serverUrl?: string | null }): string {
    const pairId = encodeURIComponent(input.pairId);
    const secret = encodeURIComponent(input.secret);

    const serverSegment =
        input.serverUrl != null && input.serverUrl.length > 0
            ? `&server=${encodeURIComponent(input.serverUrl)}`
            : '';

    return `${resolveAppUrlScheme()}:///pair?v=1&pairId=${pairId}&secret=${secret}${serverSegment}`;
}
