import { BackendTargetKeySchema } from '@happier-dev/protocol';
import { z } from 'zod';

export const FavoriteBackendTargetKeysV1Schema = z.preprocess((value) => {
    const values = Array.isArray(value) ? value : [];
    const uniqueKeys: string[] = [];
    const seen = new Set<string>();

    for (const raw of values) {
        if (typeof raw !== 'string') continue;
        const key = raw.trim();
        if (!BackendTargetKeySchema.safeParse(key).success) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueKeys.push(key);
    }

    return uniqueKeys;
}, z.array(BackendTargetKeySchema).default([]));

export type FavoriteBackendTargetKeysV1 = z.infer<typeof FavoriteBackendTargetKeysV1Schema>;

export function toggleFavoriteBackendTargetKey(
    favoriteTargetKeys: ReadonlyArray<string>,
    targetKey: string,
): string[] {
    const normalizedTargetKey = targetKey.trim();
    const existing = FavoriteBackendTargetKeysV1Schema.parse(favoriteTargetKeys);
    if (!BackendTargetKeySchema.safeParse(normalizedTargetKey).success) return existing;

    if (existing.includes(normalizedTargetKey)) {
        return existing.filter((key) => key !== normalizedTargetKey);
    }

    return [...existing, normalizedTargetKey];
}

export function sortItemsByFavoriteTargetKey<Item>(
    items: ReadonlyArray<Item>,
    favoriteTargetKeys: ReadonlyArray<string>,
    getTargetKey: (item: Item) => string,
): Item[] {
    if (items.length <= 1 || favoriteTargetKeys.length === 0) return [...items];

    const orderByKey = new Map<string, number>();
    favoriteTargetKeys.forEach((key, index) => {
        if (!orderByKey.has(key)) {
            orderByKey.set(key, index);
        }
    });

    return items
        .map((item, index) => ({
            item,
            index,
            favoriteOrder: orderByKey.get(getTargetKey(item)),
        }))
        .sort((left, right) => {
            const leftFavorite = left.favoriteOrder !== undefined;
            const rightFavorite = right.favoriteOrder !== undefined;
            if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1;
            if (left.favoriteOrder !== undefined && right.favoriteOrder !== undefined) {
                return left.favoriteOrder - right.favoriteOrder;
            }
            return left.index - right.index;
        })
        .map((entry) => entry.item);
}
