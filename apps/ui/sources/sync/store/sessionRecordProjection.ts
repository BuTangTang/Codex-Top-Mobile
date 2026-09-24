export function forEachRecordValue<T>(
    record: Readonly<Record<string, T>>,
    visit: (value: T, id: string) => void,
): void {
    for (const id in record) {
        if (!Object.prototype.hasOwnProperty.call(record, id)) continue;
        visit(record[id], id);
    }
}

export function forEachRecordValueById<T>(
    record: Readonly<Record<string, T>>,
    ids: readonly string[],
    visit: (value: T, id: string) => void,
): void {
    for (const id of ids) {
        if (!Object.prototype.hasOwnProperty.call(record, id)) continue;
        visit(record[id], id);
    }
}

export function collectRecordIds<T>(record: Readonly<Record<string, T>>): string[] {
    const ids: string[] = [];
    for (const id in record) {
        if (!Object.prototype.hasOwnProperty.call(record, id)) continue;
        ids.push(id);
    }
    return ids;
}

export function hasRecordValues<T>(record: Readonly<Record<string, T>>): boolean {
    for (const id in record) {
        if (Object.prototype.hasOwnProperty.call(record, id)) {
            return true;
        }
    }
    return false;
}
