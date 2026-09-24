export function formatPathRelativeToHome(path: string, homeDir?: string): string {
    if (!homeDir) return path;

    const normalizedHome = homeDir.replace(/[\\/]+$/, '');
    const normalizedPath = path;

    if (normalizedPath === normalizedHome || normalizedPath.replace(/[\\/]+$/, '') === normalizedHome) {
        return '~';
    }

    if (!normalizedPath.startsWith(normalizedHome)) {
        return path;
    }

    const remainder = normalizedPath.slice(normalizedHome.length);
    if (!/^[\\/]+/.test(remainder)) {
        return path;
    }

    return `~/${remainder.replace(/^[\\/]+/, '').replace(/[\\/]+/g, '/')}`;
}
