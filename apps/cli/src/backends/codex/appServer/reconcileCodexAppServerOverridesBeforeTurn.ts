import { logger } from '@/ui/logger';

export type CodexAppServerOverrideFlushTarget = {
    flushPendingAfterStart: () => Promise<void>;
};

export type CodexAppServerOverrideSession = {
    refreshSessionSnapshotFromServerBestEffort?: (options: {
        reason: 'waitForMetadataUpdate';
    }) => Promise<void>;
};

export async function reconcileCodexAppServerOverridesBeforeTurn(options: {
    session: CodexAppServerOverrideSession;
    syncOverridesFromMetadata: () => void;
    sessionModeSync?: CodexAppServerOverrideFlushTarget | null;
    configOptionSync?: CodexAppServerOverrideFlushTarget | null;
    modelSync?: CodexAppServerOverrideFlushTarget | null;
}): Promise<void> {
    try {
        await options.session.refreshSessionSnapshotFromServerBestEffort?.({
            reason: 'waitForMetadataUpdate',
        });
    } catch (error) {
        logger.debug('[CodexAppServer] Failed to refresh metadata before turn (non-fatal)', error);
    }

    options.syncOverridesFromMetadata();

    await options.sessionModeSync?.flushPendingAfterStart();
    await options.configOptionSync?.flushPendingAfterStart();
    await options.modelSync?.flushPendingAfterStart();
}
