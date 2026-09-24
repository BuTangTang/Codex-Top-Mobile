export function readSessionIdFromPathname(pathname: string): string | null {
    const match = pathname.match(/\/session\/([^/?#]+)/);
    const sessionIdCandidate = match?.[1]?.trim() ?? '';
    if (!sessionIdCandidate) return null;
    try {
        const decoded = decodeURIComponent(sessionIdCandidate).trim();
        return decoded || null;
    } catch {
        return sessionIdCandidate || null;
    }
}
