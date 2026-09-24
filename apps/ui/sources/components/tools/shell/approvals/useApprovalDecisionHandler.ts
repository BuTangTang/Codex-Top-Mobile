import * as React from 'react';
import { type ActionId } from '@happier-dev/protocol';

import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';
import { createDefaultActionExecutor } from '@/sync/ops/actions/defaultActionExecutor';
import { resolveServerIdForSessionIdFromLocalCache } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';
import { Modal } from '@/modal';
import { t } from '@/text';

function readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function useApprovalDecisionHandler(params: Readonly<{
    artifact: Pick<DecryptedArtifact, 'id' | 'header'>;
    sessionId: string;
    requestServerId?: string | null;
}>) {
    const [isDeciding, setIsDeciding] = React.useState(false);
    const executor = React.useMemo(
        () => createDefaultActionExecutor({ resolveServerIdForSessionId: resolveServerIdForSessionIdFromLocalCache }),
        [],
    );

    const serverId = React.useMemo(() => {
        const requestServerId = readString(params.requestServerId);
        if (requestServerId) return requestServerId;

        const headerServerId = readString(params.artifact.header?.serverId);
        if (headerServerId) return headerServerId;

        const sessionId = params.sessionId.trim();
        return sessionId ? resolveServerIdForSessionIdFromLocalCache(sessionId) : null;
    }, [params.artifact.header?.serverId, params.requestServerId, params.sessionId]);

    const decide = React.useCallback(async (decision: 'approve' | 'reject') => {
        if (isDeciding) return;

        try {
            setIsDeciding(true);
            const result = await executor.execute(
                'approval.request.decide' as ActionId,
                { artifactId: params.artifact.id, decision },
                { surface: 'ui_button', ...(serverId ? { serverId } : {}) },
            );
            if (!result.ok) {
                throw new Error(result.errorCode);
            }
        } catch {
            Modal.alert(t('common.error'), t('approvals.decisionError'));
        } finally {
            setIsDeciding(false);
        }
    }, [executor, isDeciding, params.artifact.id, serverId]);

    return { decide, isDeciding };
}
