export const SESSION_LIST_FOLDER_SORT_MODES_V1 = ['foldersFirst', 'mixed'] as const;
export const SESSION_LIST_FOLDER_SORT_MODE_VALUES = SESSION_LIST_FOLDER_SORT_MODES_V1;

export type SessionListFolderSortModeV1 = typeof SESSION_LIST_FOLDER_SORT_MODES_V1[number];

export const SESSION_LIST_FOLDER_SORT_MODE_DEFAULT_V1: SessionListFolderSortModeV1 = 'foldersFirst';

export function normalizeSessionListFolderSortMode(value: unknown): SessionListFolderSortModeV1 {
    return value === 'mixed' ? 'mixed' : SESSION_LIST_FOLDER_SORT_MODE_DEFAULT_V1;
}

export const normalizeSessionListFolderSortModeV1 = normalizeSessionListFolderSortMode;
