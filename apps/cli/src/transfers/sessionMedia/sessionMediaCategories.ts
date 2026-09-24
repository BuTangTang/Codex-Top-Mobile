export type SessionMediaCategory = 'messages' | 'generated' | 'artifacts';
export type PersistedSessionMediaCategory = 'attachment' | 'generated' | 'tool-artifact';

export function sessionMediaCategoryToDirectory(category: SessionMediaCategory): string {
    return category;
}

export function persistedSessionMediaCategoryToTransferCategory(
    category: PersistedSessionMediaCategory,
): SessionMediaCategory {
    if (category === 'attachment') return 'messages';
    if (category === 'tool-artifact') return 'artifacts';
    return 'generated';
}

export function isDurableSessionMediaCategory(category: SessionMediaCategory): boolean {
    return category === 'generated' || category === 'artifacts';
}
