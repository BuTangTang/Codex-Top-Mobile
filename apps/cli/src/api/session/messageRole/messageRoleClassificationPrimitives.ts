export function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function readStringProperty(value: unknown, key: string): string | null {
    const record = asRecord(value);
    if (!record) return null;
    const raw = record[key];
    return typeof raw === 'string' ? raw : null;
}

export function readType(value: unknown): string | null {
    return readStringProperty(value, 'type');
}

export function readNestedProperty(value: unknown, key: string): unknown {
    const record = asRecord(value);
    return record ? record[key] : undefined;
}
