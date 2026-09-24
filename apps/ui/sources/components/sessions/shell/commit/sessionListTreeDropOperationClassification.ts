import type {
    SessionListTreeContainerMetadata,
    SessionListTreeDragSource,
    SessionListTreeRowMetadata,
} from '../drop-resolution/sessionListTreeTypes';

export type SessionListTreeDropOperationKind =
    | 'sessionSiblingReorder'
    | 'sessionContainerContainmentMove'
    | 'folderSiblingReorder'
    | 'folderNestingMove'
    | 'workspaceStructuralReorder'
    | 'invalid'
    | 'noop';

type SessionListTreeDropDestinationLike = Readonly<{
    container: SessionListTreeContainerMetadata;
    beforeRowId: string | null;
    afterRowId: string | null;
    target: SessionListTreeRowMetadata | null;
}>;

export function classifySessionListTreeDropOperation(params: Readonly<{
    source: SessionListTreeDragSource;
    destination: SessionListTreeDropDestinationLike | null;
    currentParentFolderId?: string | null;
}>): SessionListTreeDropOperationKind {
    const { source, destination } = params;
    if (!destination) return 'invalid';

    if (source.metadata.kind === 'session') {
        return (source.metadata.folderId ?? null) === destination.container.folderId
            ? 'sessionSiblingReorder'
            : 'sessionContainerContainmentMove';
    }

    if (source.metadata.kind === 'folder') {
        const currentParentFolderId = params.currentParentFolderId ?? null;
        const destinationParentFolderId = destination.container.folderId;
        if (currentParentFolderId !== destinationParentFolderId) return 'folderNestingMove';
        if (destination.beforeRowId || destination.afterRowId) return 'folderSiblingReorder';
        return 'noop';
    }

    if (source.metadata.kind === 'workspace-root') {
        return 'workspaceStructuralReorder';
    }

    return 'invalid';
}
