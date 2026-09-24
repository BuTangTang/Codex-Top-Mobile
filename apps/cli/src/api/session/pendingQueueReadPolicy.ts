export type PendingQueueReconcileWhenEmpty = 'force' | 'throttled' | 'skip';

export type PendingQueueReadReason =
    | 'passive-wait'
    | 'explicit-drain'
    | 'startup-drain'
    | 'manual-check'
    | 'reconnect-catchup'
    | 'degraded-socket';

export type PendingQueueReadOptions = {
    reconcileWhenEmpty?: PendingQueueReconcileWhenEmpty | undefined;
    reason?: PendingQueueReadReason | undefined;
};

export function resolvePendingQueueReconcileWhenEmpty(
    opts: PendingQueueReadOptions | undefined,
    fallback: PendingQueueReconcileWhenEmpty,
): PendingQueueReconcileWhenEmpty {
    return opts?.reconcileWhenEmpty ?? fallback;
}
