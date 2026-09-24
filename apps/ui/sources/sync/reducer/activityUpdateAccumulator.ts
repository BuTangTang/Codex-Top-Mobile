import type { ApiEphemeralActivityUpdate } from '../api/types/apiTypes';

export type ActivityUpdateAccumulatorFlushOptions = Readonly<{
    sourceServerId?: string | null;
}>;

type ActivityUpdateAccumulatorOptions = Readonly<{
    shouldContinue?: () => boolean;
    sourceServerId?: string | null;
}>;

type PendingActivityUpdate = Readonly<{
    update: ApiEphemeralActivityUpdate;
    shouldContinue: () => boolean;
    sourceServerId: string | null;
}>;

type LastEmittedActivityState = Readonly<{
    active: boolean;
    thinking: boolean;
    activeAt: number;
}>;

type GroupedPendingActivityUpdates = {
    updates: Map<string, ApiEphemeralActivityUpdate>;
    emittedStates: Map<string, LastEmittedActivityState>;
};

function normalizeSourceServerId(value: string | null | undefined): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
}

function buildPendingUpdateKey(sessionId: string, sourceServerId: string | null): string {
    return `${sourceServerId ?? ''}\u0000${sessionId}`;
}

export class ActivityUpdateAccumulator {
    private pendingUpdates = new Map<string, PendingActivityUpdate>();
    private lastEmittedStates = new Map<string, LastEmittedActivityState>();
    private timeoutId: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private flushHandler: (updates: Map<string, ApiEphemeralActivityUpdate>, options?: ActivityUpdateAccumulatorFlushOptions) => void,
        private debounceDelay: number = 500
    ) {}

    addUpdate(update: ApiEphemeralActivityUpdate, options?: ActivityUpdateAccumulatorOptions): void {
        const sourceServerId = normalizeSourceServerId(options?.sourceServerId);
        const sessionId = update.id;
        const updateKey = buildPendingUpdateKey(sessionId, sourceServerId);
        const lastState = this.lastEmittedStates.get(updateKey);
        const thinking = update.thinking ?? false;
        const pendingUpdate: PendingActivityUpdate = {
            update,
            shouldContinue: options?.shouldContinue ?? (() => true),
            sourceServerId,
        };

        // Check if this is a critical timestamp update (more than half of disconnect timeout old)
        const timeSinceLastUpdate = lastState ? update.activeAt - lastState.activeAt : 0;
        const isCriticalTimestamp = timeSinceLastUpdate > 60000; // Half of 120 second timeout

        // Check if this is a significant state change that needs immediate emission
        const isSignificantChange = !lastState ||
            lastState.active !== update.active ||
            lastState.thinking !== thinking ||
            isCriticalTimestamp;

        if (isSignificantChange) {
            // Cancel any pending timeout
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }

            // Add the immediate update to pending updates
            this.pendingUpdates.set(updateKey, pendingUpdate);

            // Flush all pending updates together (batched)
            this.flushPendingUpdates();
        } else {
            // Accumulate for debounced emission (only timestamp updates)
            this.pendingUpdates.set(updateKey, pendingUpdate);

            // Only start a new timer if one isn't already running
            if (!this.timeoutId) {
                this.timeoutId = setTimeout(() => {
                    this.flushPendingUpdates();
                    this.timeoutId = null;
                }, this.debounceDelay);
            }
            // Don't reset the timer for subsequent updates - let it fire!
        }
    }

    private flushPendingUpdates(): void {
        if (this.pendingUpdates.size === 0) return;

        const grouped = new Map<string, GroupedPendingActivityUpdates>();
        for (const [updateKey, pending] of this.pendingUpdates) {
            if (!pending.shouldContinue()) continue;
            const sourceKey = pending.sourceServerId ?? '';
            let updatesForSource = grouped.get(sourceKey);
            if (!updatesForSource) {
                updatesForSource = {
                    updates: new Map<string, ApiEphemeralActivityUpdate>(),
                    emittedStates: new Map<string, LastEmittedActivityState>(),
                };
                grouped.set(sourceKey, updatesForSource);
            }
            updatesForSource.updates.set(pending.update.id, pending.update);
            updatesForSource.emittedStates.set(updateKey, {
                active: pending.update.active,
                thinking: pending.update.thinking ?? false,
                activeAt: pending.update.activeAt,
            });
        }

        for (const [sourceKey, groupedUpdates] of grouped) {
            if (groupedUpdates.updates.size === 0) continue;
            const sourceServerId = sourceKey || null;
            if (sourceServerId) {
                this.flushHandler(groupedUpdates.updates, { sourceServerId });
            } else {
                this.flushHandler(groupedUpdates.updates);
            }
            for (const [updateKey, state] of groupedUpdates.emittedStates) {
                this.lastEmittedStates.set(updateKey, state);
            }
        }

        // Clear pending updates
        this.pendingUpdates.clear();
    }

    cancel(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        this.pendingUpdates.clear();
    }

    reset(): void {
        this.cancel();
        this.lastEmittedStates.clear();
    }

    flush(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        this.flushPendingUpdates();
    }
}
