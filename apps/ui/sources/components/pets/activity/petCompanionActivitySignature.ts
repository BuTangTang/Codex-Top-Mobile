export function readString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function readNumber(value: unknown): number | string {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : '';
}

export function readBoolean(value: unknown): 0 | 1 | '' {
    return typeof value === 'boolean' ? (value ? 1 : 0) : '';
}

function readObjectRecord(value: unknown): Readonly<Record<string, unknown>> | null {
    return value && typeof value === 'object' ? value as Readonly<Record<string, unknown>> : null;
}

export function joinSignatureParts(parts: readonly unknown[]): string {
    return parts.map((part) => {
        const value = String(part ?? '');
        return `${value.length}:${value}`;
    }).join('');
}

export function readDirectSessionSignature(value: unknown): string {
    const directSession = readObjectRecord(value);
    if (!directSession) return '';
    return joinSignatureParts([
        readNumber(directSession.v),
        readString(directSession.providerId),
        readString(directSession.machineId),
        readString(directSession.remoteSessionId),
        readString(directSession.source),
    ]);
}

export function readRuntimeIssueSignature(value: unknown): string {
    const issue = readObjectRecord(value);
    if (!issue) return '';
    return joinSignatureParts([
        readString(issue.status),
        readNumber(issue.occurredAt),
        readString(issue.code),
        readString(issue.message),
    ]);
}
