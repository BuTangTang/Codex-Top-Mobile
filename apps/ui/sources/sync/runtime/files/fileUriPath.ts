export function joinFileUri(baseUri: string, childPath: string): string {
    const base = String(baseUri ?? '').trim();
    const child = String(childPath ?? '').trim().replace(/^\/+/g, '');
    if (!base) return child;
    if (!child) return base;
    const withSlash = base.endsWith('/') ? base : `${base}/`;
    return `${withSlash}${child}`;
}
