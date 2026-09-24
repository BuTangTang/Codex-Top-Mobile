import * as React from 'react';

import { storage } from '@/sync/domains/state/storage';
import { REPOSITORY_TREE_AUTO_EXPAND_DELAY_MS } from '@/components/sessions/files/repositoryTree/repositoryTreeDragAndDropConfig';
import type { RepositoryTreeWebDropTarget } from '@/components/sessions/files/content/RepositoryTreeList';

function appendExpandedPath(expandedPaths: readonly string[], path: string): string[] {
    if (!path) return [...expandedPaths];
    if (expandedPaths.includes(path)) return [...expandedPaths];
    return [...expandedPaths, path];
}

export function useRepositoryTreeWebDropState(params: Readonly<{
    sessionId: string;
    enabled: boolean;
    expandedPaths: readonly string[];
}>) {
    const { sessionId, enabled, expandedPaths } = params;
    const [fileDragActive, setFileDragActive] = React.useState(false);
    const [dropTarget, setDropTarget] = React.useState<RepositoryTreeWebDropTarget>({
        destinationDir: '',
        hoverPath: null,
        autoExpandDirectoryPath: null,
    });
    const expandedPathsRef = React.useRef(params.expandedPaths);
    const autoExpandTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoExpandPathRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        expandedPathsRef.current = expandedPaths;
    }, [expandedPaths]);

    const clearAutoExpandTimer = React.useCallback(() => {
        if (autoExpandTimerRef.current) {
            clearTimeout(autoExpandTimerRef.current);
            autoExpandTimerRef.current = null;
        }
        autoExpandPathRef.current = null;
    }, []);

    const resetDropTarget = React.useCallback(() => {
        clearAutoExpandTimer();
        setDropTarget({
            destinationDir: '',
            hoverPath: null,
            autoExpandDirectoryPath: null,
        });
    }, [clearAutoExpandTimer]);

    React.useEffect(() => {
        if (enabled) return;
        setFileDragActive(false);
        resetDropTarget();
    }, [enabled, resetDropTarget]);

    React.useEffect(() => clearAutoExpandTimer, [clearAutoExpandTimer]);

    const scheduleAutoExpand = React.useCallback((directoryPath: string | null) => {
        if (!enabled) {
            clearAutoExpandTimer();
            return;
        }
        if (!directoryPath || expandedPathsRef.current.includes(directoryPath)) {
            clearAutoExpandTimer();
            return;
        }
        if (autoExpandPathRef.current === directoryPath && autoExpandTimerRef.current) {
            return;
        }
        clearAutoExpandTimer();
        autoExpandPathRef.current = directoryPath;
        autoExpandTimerRef.current = setTimeout(() => {
            storage.getState().setSessionRepositoryTreeExpandedPaths(
                sessionId,
                appendExpandedPath(expandedPathsRef.current, directoryPath),
            );
            autoExpandTimerRef.current = null;
            autoExpandPathRef.current = null;
        }, REPOSITORY_TREE_AUTO_EXPAND_DELAY_MS);
    }, [clearAutoExpandTimer, enabled, sessionId]);

    const onDropTargetChange = React.useCallback((target: RepositoryTreeWebDropTarget) => {
        if (!enabled) return;
        setDropTarget(target);
        scheduleAutoExpand(target.autoExpandDirectoryPath ?? null);
    }, [enabled, scheduleAutoExpand]);

    const onFileDragActiveChange = React.useCallback((active: boolean) => {
        if (!enabled) {
            setFileDragActive(false);
            resetDropTarget();
            return;
        }
        setFileDragActive(active);
        if (!active) {
            resetDropTarget();
        }
    }, [enabled, resetDropTarget]);

    const setRootDropTarget = React.useCallback(() => {
        if (!enabled) return;
        onDropTargetChange({
            destinationDir: '',
            hoverPath: null,
            autoExpandDirectoryPath: null,
        });
    }, [onDropTargetChange, enabled]);

    return React.useMemo(() => ({
        fileDragActive,
        dropDestinationDir: dropTarget.destinationDir,
        dropHoverPath: dropTarget.hoverPath,
        onDropTargetChange,
        onFileDragActiveChange,
        setRootDropTarget,
    }), [
        dropTarget.destinationDir,
        dropTarget.hoverPath,
        fileDragActive,
        onDropTargetChange,
        onFileDragActiveChange,
        setRootDropTarget,
    ]);
}
