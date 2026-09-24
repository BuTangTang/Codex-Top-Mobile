import React from 'react';

import { useLocalSettingMutable, type SessionListViewItem } from '@/sync/domains/state/storage';

import {
    buildSessionFolderBreadcrumbs,
    type SessionFolderHeaderItem,
} from '../sessionFolderShellTypes';

const EMPTY_SESSION_FOLDER_BREADCRUMBS: ReadonlyArray<SessionFolderHeaderItem> = Object.freeze([]);

type UseSessionListFocusedFolderStateInput = Readonly<{
    canInvalidateFocusedFolder?: boolean;
    folderViewEnabled: boolean;
    folderPresentedData: ReadonlyArray<SessionListViewItem> | null | undefined;
}>;

export function useSessionListFocusedFolderState({
    canInvalidateFocusedFolder = true,
    folderViewEnabled,
    folderPresentedData,
}: UseSessionListFocusedFolderStateInput) {
    const [sessionListFocusedFolderV1, setSessionListFocusedFolderV1] = useLocalSettingMutable('sessionListFocusedFolderV1');
    const setSessionListFocusedFolderV1Ref = React.useRef(setSessionListFocusedFolderV1);
    setSessionListFocusedFolderV1Ref.current = setSessionListFocusedFolderV1;

    const focusedFolderId = folderViewEnabled && sessionListFocusedFolderV1
        ? sessionListFocusedFolderV1.folderId
        : null;

    const folderBreadcrumbs = React.useMemo(() => {
        if (!folderViewEnabled || !focusedFolderId || !folderPresentedData) return EMPTY_SESSION_FOLDER_BREADCRUMBS;
        return buildSessionFolderBreadcrumbs(folderPresentedData, focusedFolderId);
    }, [folderPresentedData, focusedFolderId, folderViewEnabled]);

    React.useEffect(() => {
        if (!canInvalidateFocusedFolder) return;
        if (!focusedFolderId) return;
        if (!folderViewEnabled || folderBreadcrumbs.length === 0) {
            setSessionListFocusedFolderV1Ref.current(null);
        }
    }, [canInvalidateFocusedFolder, focusedFolderId, folderBreadcrumbs.length, folderViewEnabled]);

    const focusFolder = React.useCallback((folder: SessionFolderHeaderItem | null) => {
        if (!folder?.workspace) return;
        setSessionListFocusedFolderV1Ref.current({
            folderId: folder.folderId,
            workspace: folder.workspace,
            renderWorkspaceKey: folder.renderWorkspaceKey,
            serverId: folder.serverId ?? folder.workspace.serverId ?? null,
        });
    }, []);

    const clearFolderFocus = React.useCallback(() => {
        setSessionListFocusedFolderV1Ref.current(null);
    }, []);

    const focusBreadcrumbFolder = React.useCallback((folderId: string) => {
        const folder = folderBreadcrumbs.find((candidate) => candidate.folderId === folderId) ?? null;
        focusFolder(folder);
    }, [focusFolder, folderBreadcrumbs]);

    return {
        focusedFolderId,
        folderBreadcrumbs,
        focusFolder,
        clearFolderFocus,
        focusBreadcrumbFolder,
    };
}
