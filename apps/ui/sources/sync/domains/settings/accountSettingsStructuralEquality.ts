function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function areAccountSettingsJsonValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right)) return false;
        if (left.length !== right.length) return false;
        return left.every((value, index) => areAccountSettingsJsonValuesEqual(value, right[index]));
    }
    if (isRecord(left) || isRecord(right)) {
        if (!isRecord(left) || !isRecord(right)) return false;
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        if (leftKeys.length !== rightKeys.length) return false;
        return leftKeys.every((key, index) => (
            key === rightKeys[index]
            && areAccountSettingsJsonValuesEqual(left[key], right[key])
        ));
    }
    return false;
}
