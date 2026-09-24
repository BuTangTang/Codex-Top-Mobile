/**
 * FR4-7: home-aware favorite directory toggle.
 *
 * The `favoriteDirectories` setting can store paths in either form:
 *   - Absolute: `/Users/alice/src/app`
 *   - Home-relative shorthand (portable across machines): `~/src/app`
 *
 * Toggle requests, however, always arrive with the absolute path the user
 * clicked (e.g. from the path picker rows). The previous implementation
 * compared the stored entry to the click target by raw string equality, so a
 * stored `~/src/app` entry could never be removed by pressing the filled-star
 * on its `/Users/alice/src/app` row — the filter never matched, and the
 * absolute path was appended as a duplicate.
 *
 * This helper normalizes BOTH sides via `resolveAbsolutePath` before comparing:
 *   - Remove: every stored entry whose resolved absolute matches the target's
 *     resolved absolute is removed (so duplicate home-relative + absolute
 *     entries are deduped in a single press).
 *   - Add: when the target is not yet a favorite, it is appended in its
 *     original (caller-supplied) form so callers that pass shorthand keep
 *     portability across machines.
 *
 * The helper is intentionally pure so it can be exercised in unit tests
 * without React or storage plumbing.
 */
import { normalizeFileSystemPath } from '@/sync/domains/fileSystem/normalizeFileSystemPath';
import { resolveAbsolutePath } from '@/utils/path/pathUtils';

export function resolveDirectoryFavoriteComparisonKey(
    path: string,
    homeDir: string | null | undefined,
): string {
    const safeHomeDir = typeof homeDir === 'string' && homeDir.length > 0 ? homeDir : undefined;
    const resolvedPath = resolveAbsolutePath(path, safeHomeDir);
    return normalizeFileSystemPath(resolvedPath) ?? resolvedPath;
}

export function normalizeDirectoryFavoritePaths(
    storedFavorites: ReadonlyArray<unknown> | null | undefined,
    homeDir: string | null | undefined,
): ReadonlyArray<string> {
    const sanitized = Array.isArray(storedFavorites)
        ? storedFavorites.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    const seenKeys = new Set<string>();
    const normalized: string[] = [];
    for (const stored of sanitized) {
        const storedKey = resolveDirectoryFavoriteComparisonKey(stored, homeDir);
        if (seenKeys.has(storedKey)) continue;
        seenKeys.add(storedKey);
        normalized.push(stored);
    }
    return normalized;
}

export function toggleHomeAwareDirectoryFavorite(
    storedFavorites: ReadonlyArray<unknown> | null | undefined,
    target: string,
    homeDir: string | null | undefined,
): ReadonlyArray<string> {
    const targetKey = resolveDirectoryFavoriteComparisonKey(target, homeDir);
    const sanitized = normalizeDirectoryFavoritePaths(storedFavorites, homeDir);

    const isFavorite = sanitized.some(
        (stored) => resolveDirectoryFavoriteComparisonKey(stored, homeDir) === targetKey,
    );

    if (isFavorite) {
        return sanitized.filter(
            (stored) => resolveDirectoryFavoriteComparisonKey(stored, homeDir) !== targetKey,
        );
    }

    return [...sanitized, target];
}
