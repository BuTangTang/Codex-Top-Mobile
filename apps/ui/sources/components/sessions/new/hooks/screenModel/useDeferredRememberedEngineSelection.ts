import * as React from 'react';
import {
    buildBackendTargetKey,
    type AcpConfigOptionOverridesV1,
    type BackendTargetRefV1,
} from '@happier-dev/protocol';

import {
    readRememberedEngineSelection,
    upsertRememberedEngineSelection,
    type RememberedEngineSelectionsByScopeV1,
} from '@/sync/domains/sessionAuthoring/rememberedEngineSelections';

export const REMEMBERED_ENGINE_SELECTION_WRITE_DELAY_MS = 3000;

type RememberedEngineSelectionInput = Readonly<{
    modelId?: string | null;
    acpSessionModeId?: string | null;
    sessionConfigOptionOverrides?: AcpConfigOptionOverridesV1 | null;
}>;

type DeferredRememberedEngineSelectionParams = Readonly<{
    enabled: boolean;
    selectionsByScope: unknown;
    serverId: string | null | undefined;
    commit: (nextSelectionsByScope: RememberedEngineSelectionsByScopeV1) => void;
    delayMs?: number;
}>;

type DeferredRememberedEngineSelectionRequest = Readonly<{
    backendTarget: BackendTargetRefV1;
    selection: RememberedEngineSelectionInput;
}>;

type DeferredRememberedEngineSelectionSnapshot =
    & DeferredRememberedEngineSelectionParams
    & DeferredRememberedEngineSelectionRequest;

function buildStableSignature(value: unknown): string {
    try {
        return JSON.stringify(value) ?? 'null';
    } catch {
        return 'unserializable';
    }
}

function areRememberedEngineSelectionsEquivalent(
    left: Readonly<{
        modelId: string | null;
        acpSessionModeId: string | null;
        sessionConfigOptionOverrides: AcpConfigOptionOverridesV1 | null;
    }>,
    right: Readonly<{
        modelId: string | null;
        acpSessionModeId: string | null;
        sessionConfigOptionOverrides: AcpConfigOptionOverridesV1 | null;
    }>,
): boolean {
    return left.modelId === right.modelId
        && left.acpSessionModeId === right.acpSessionModeId
        && buildStableSignature(left.sessionConfigOptionOverrides ?? null) === buildStableSignature(right.sessionConfigOptionOverrides ?? null);
}

function shouldCommitRememberedEngineSelection(params: DeferredRememberedEngineSelectionSnapshot): boolean {
    if (!params.enabled) return false;

    const existing = readRememberedEngineSelection({
        enabled: true,
        selectionsByScope: params.selectionsByScope,
        serverId: params.serverId,
        backendTarget: params.backendTarget,
    });
    const next = upsertRememberedEngineSelection({
        selectionsByScope: params.selectionsByScope,
        serverId: params.serverId,
        backendTarget: params.backendTarget,
        selection: params.selection,
        updatedAt: Date.now(),
    });
    const resolved = readRememberedEngineSelection({
        enabled: true,
        selectionsByScope: next,
        serverId: params.serverId,
        backendTarget: params.backendTarget,
    });

    return !(existing && resolved && areRememberedEngineSelectionsEquivalent(existing, resolved));
}

export function useDeferredRememberedEngineSelection(
    params: DeferredRememberedEngineSelectionParams,
): (backendTarget: BackendTargetRefV1, selection: RememberedEngineSelectionInput) => void {
    const latestParamsRef = React.useRef(params);
    latestParamsRef.current = params;
    const latestRequestRef = React.useRef<DeferredRememberedEngineSelectionRequest | null>(null);
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearPendingCommit = React.useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const flushPendingCommit = React.useCallback(() => {
        clearPendingCommit();
        const latest = latestParamsRef.current;
        const request = latestRequestRef.current;
        if (!request) return;
        const snapshot = {
            ...latest,
            ...request,
        };
        if (!shouldCommitRememberedEngineSelection(snapshot)) return;

        latest.commit(upsertRememberedEngineSelection({
            selectionsByScope: latest.selectionsByScope,
            serverId: latest.serverId,
            backendTarget: request.backendTarget,
            selection: request.selection,
            updatedAt: Date.now(),
        }));
    }, [clearPendingCommit]);

    const rememberEngineSelection = React.useCallback((backendTarget: BackendTargetRefV1, selection: RememberedEngineSelectionInput) => {
        latestRequestRef.current = { backendTarget, selection };
        const latest = latestParamsRef.current;
        const snapshot = {
            ...latest,
            backendTarget,
            selection,
        };
        if (!shouldCommitRememberedEngineSelection(snapshot)) {
            clearPendingCommit();
            return;
        }

        clearPendingCommit();
        timerRef.current = setTimeout(
            flushPendingCommit,
            latest.delayMs ?? REMEMBERED_ENGINE_SELECTION_WRITE_DELAY_MS,
        );
    }, [clearPendingCommit, flushPendingCommit]);

    React.useEffect(() => {
        return () => {
            flushPendingCommit();
        };
    }, [flushPendingCommit]);

    return rememberEngineSelection;
}

export function useDeferredCurrentRememberedEngineSelection(
    params: DeferredRememberedEngineSelectionParams & DeferredRememberedEngineSelectionRequest,
): void {
    const rememberEngineSelection = useDeferredRememberedEngineSelection(params);
    const targetKey = React.useMemo(() => buildBackendTargetKey(params.backendTarget), [params.backendTarget]);
    const selectionSignature = buildStableSignature(params.selection);

    React.useEffect(() => {
        rememberEngineSelection(params.backendTarget, params.selection);
    }, [
        rememberEngineSelection,
        params.backendTarget,
        selectionSignature,
        targetKey,
    ]);
}
