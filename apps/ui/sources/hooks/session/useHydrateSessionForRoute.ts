import * as React from 'react';

import {
    type EnsureSessionVisibleForRouteResult,
    type SessionRouteHydrationState,
} from '@/sync/domains/session/sessionRouteHydrationState';
import { storage } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { fireAndForget } from '@/utils/system/fireAndForget';

export type { SessionRouteHydrationState } from '@/sync/domains/session/sessionRouteHydrationState';

export type UseHydrateSessionForRouteOptions = Readonly<{
    serverId?: string;
    forceRefresh?: boolean;
}>;

type SessionRouteHydrationLoadingReason = Extract<
    SessionRouteHydrationState,
    { kind: 'loading' }
>['reason'];

type SessionRouteHydrationStateRecord = Readonly<{
    routeKey: string;
    state: SessionRouteHydrationState;
}>;

const routeHydrationRetryBaseDelayMs = 2_000;
const routeHydrationRetryMaxDelayMs = 30_000;

function normalizeRouteId(value: unknown): string {
    return String(value ?? '').trim();
}

function areRouteServerIdsEqual(leftRaw: unknown, rightRaw: unknown): boolean {
    const left = normalizeRouteId(leftRaw);
    const right = normalizeRouteId(rightRaw);
    if (!left || !right) return left === right;
    return areServerProfileIdentifiersEquivalent(left, right);
}

function withServerId<T extends { sessionId: string }>(state: T, serverId: string): T & { serverId?: string } {
    return serverId ? { ...state, serverId } : state;
}

function createLoadingState(
    sessionId: string,
    serverId: string,
    reason: SessionRouteHydrationLoadingReason,
): SessionRouteHydrationState {
    return withServerId({ kind: 'loading', sessionId, reason }, serverId);
}

function createAvailableState(sessionId: string, serverId: string): SessionRouteHydrationState {
    return withServerId({ kind: 'available', sessionId }, serverId);
}

function createMissingState(result: Extract<EnsureSessionVisibleForRouteResult, { kind: 'missing' }>): SessionRouteHydrationState {
    return result.serverId
        ? { kind: 'missing', sessionId: result.sessionId, serverId: result.serverId, cause: result.cause }
        : { kind: 'missing', sessionId: result.sessionId, cause: result.cause };
}

function createRetryingState(result: Extract<EnsureSessionVisibleForRouteResult, { kind: 'retryable_failure' }>): SessionRouteHydrationState {
    return result.serverId
        ? { kind: 'retrying', sessionId: result.sessionId, serverId: result.serverId, cause: result.cause }
        : { kind: 'retrying', sessionId: result.sessionId, cause: result.cause };
}

function areRouteHydrationStatesEqual(left: SessionRouteHydrationState, right: SessionRouteHydrationState): boolean {
    if (left.kind !== right.kind) return false;
    if (left.sessionId !== right.sessionId) return false;
    if (!areRouteServerIdsEqual(left.serverId ?? '', right.serverId ?? '')) return false;
    if (left.kind === 'loading' && right.kind === 'loading') return left.reason === right.reason;
    if (left.kind === 'retrying' && right.kind === 'retrying') return left.cause === right.cause;
    if (left.kind === 'missing' && right.kind === 'missing') return left.cause === right.cause;
    return true;
}

function resolveNextRouteHydrationState(
    current: SessionRouteHydrationState,
    next: SessionRouteHydrationState,
): SessionRouteHydrationState {
    return areRouteHydrationStatesEqual(current, next) ? current : next;
}

function uniqueRouteServerIds(...serverIds: readonly unknown[]): string[] {
    const result: string[] = [];
    for (const rawServerId of serverIds) {
        const serverId = normalizeRouteId(rawServerId);
        if (!serverId) continue;
        if (result.some((existing) => areRouteServerIdsEqual(existing, serverId))) continue;
        result.push(serverId);
    }
    return result;
}

function resolveHydratedServerIdForRouteResult(
    sessionId: string,
    routeServerId: string,
    resultServerId: string | null | undefined,
): string | null {
    for (const candidateServerId of uniqueRouteServerIds(routeServerId, resultServerId)) {
        if (readHydratedRouteSnapshot(sessionId, candidateServerId)) {
            return candidateServerId;
        }
    }
    if (!routeServerId && readHydratedRouteSnapshot(sessionId, '')) {
        return '';
    }
    return null;
}

export function hasAuthoritativeHydratedSessionForRoute(sessionId: string, serverId?: string | null): boolean {
    const session = storage.getState().sessions[sessionId] ?? null;
    if (!session || session.metadata == null) {
        return false;
    }
    if (serverId && !areRouteServerIdsEqual(String(session.serverId ?? '').trim(), serverId)) {
        return false;
    }
    if (session.encryptionMode === 'plain') {
        return true;
    }
    try {
        return Boolean(sync.encryption.getSessionEncryption(sessionId));
    } catch {
        return false;
    }
}

function readHydratedRouteServerId(sessionId: string, serverId: string): string | null {
    if (!sessionId) return null;
    if (hasAuthoritativeHydratedSessionForRoute(sessionId, serverId || null)) {
        return serverId;
    }

    if (!serverId) return null;
    const sessionServerId = normalizeRouteId(storage.getState().sessions[sessionId]?.serverId);
    const activeServerId = normalizeRouteId(getActiveServerSnapshot().serverId);
    if (!sessionServerId || !activeServerId) return null;
    if (!areRouteServerIdsEqual(sessionServerId, activeServerId)) return null;
    return hasAuthoritativeHydratedSessionForRoute(sessionId, sessionServerId) ? sessionServerId : null;
}

function readHydratedRouteSnapshot(sessionId: string, serverId: string): boolean {
    return readHydratedRouteServerId(sessionId, serverId) !== null;
}

function resolveRetryDelayMs(attemptCount: number): number {
    return Math.min(
        routeHydrationRetryBaseDelayMs * Math.pow(2, Math.max(0, attemptCount - 1)),
        routeHydrationRetryMaxDelayMs,
    );
}

/**
 * Best-effort hydration for deep links / hard refreshes.
 *
 * Some session sub-routes can be opened directly without mounting the main
 * `SessionView`, which normally ensures the session exists in storage and
 * initializes its encryption state. Route hydration is explicit so consumers
 * can distinguish loading/retrying from terminal missing.
 */
export function useHydrateSessionForRoute(
    sessionId: string,
    tag: string,
    options?: UseHydrateSessionForRouteOptions,
): SessionRouteHydrationState {
    const normalizedSessionId = normalizeRouteId(sessionId);
    const normalizedServerId = normalizeRouteId(options?.serverId);
    const forceRefresh = options?.forceRefresh === true;
    const routeKey = `${normalizedServerId}\n${normalizedSessionId}`;

    const hasHydratedSession = React.useSyncExternalStore(
        storage.subscribe,
        () => readHydratedRouteSnapshot(normalizedSessionId, normalizedServerId),
        () => readHydratedRouteSnapshot(normalizedSessionId, normalizedServerId),
    );

    const [routeStateRecord, setRouteStateRecord] = React.useState<SessionRouteHydrationStateRecord>(() => ({
        routeKey,
        state: hasHydratedSession
            ? createAvailableState(normalizedSessionId, normalizedServerId)
            : createLoadingState(normalizedSessionId, normalizedServerId, 'cold'),
    }));

    React.useEffect(() => {
        let canceled = false;
        let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
        let attemptCount = 0;

        if (!normalizedSessionId) {
            setRouteStateRecord((current) => ({
                routeKey,
                state: resolveNextRouteHydrationState(
                    current.routeKey === routeKey ? current.state : createLoadingState(normalizedSessionId, normalizedServerId, 'cold'),
                    createLoadingState(normalizedSessionId, normalizedServerId, 'cold'),
                ),
            }));
            return;
        }

        if (hasHydratedSession && !forceRefresh) {
            return;
        }

        if (!hasHydratedSession || forceRefresh) {
            setRouteStateRecord((current) => {
                const currentState = current.routeKey === routeKey
                    ? current.state
                    : createLoadingState(normalizedSessionId, normalizedServerId, 'store-miss');
                if (forceRefresh && currentState.kind === 'available') {
                    return { routeKey, state: currentState };
                }
                return {
                    routeKey,
                    state: resolveNextRouteHydrationState(
                        currentState,
                        createLoadingState(
                            normalizedSessionId,
                            normalizedServerId,
                            forceRefresh ? 'refreshing' : 'store-miss',
                        ),
                    ),
                };
            });
        }

        const scheduleRetry = () => {
            const retryDelayMs = resolveRetryDelayMs(attemptCount);
            retryTimeoutId = setTimeout(() => {
                if (!canceled) {
                    attemptHydration();
                }
            }, retryDelayMs);
        };

        const attemptHydration = () => {
            if (canceled) return;

            attemptCount += 1;
            const hydrationOptions = normalizedServerId || forceRefresh
                ? {
                      ...(normalizedServerId ? { serverId: normalizedServerId } : {}),
                      ...(forceRefresh ? { forceRefresh: true } : {}),
                  }
                : undefined;
            const promise = sync.ensureSessionVisibleForMessageRoute(normalizedSessionId, hydrationOptions);
            fireAndForget(promise, { tag });

            void promise
                .then((result) => {
                    if (canceled) return;
                    if (result.kind === 'missing') {
                        setRouteStateRecord((current) => ({
                            routeKey,
                            state: resolveNextRouteHydrationState(
                                current.routeKey === routeKey ? current.state : createLoadingState(normalizedSessionId, normalizedServerId, 'store-miss'),
                                createMissingState(result),
                            ),
                        }));
                        return;
                    }
                    if (result.kind === 'retryable_failure') {
                        setRouteStateRecord((current) => ({
                            routeKey,
                            state: resolveNextRouteHydrationState(
                                current.routeKey === routeKey ? current.state : createLoadingState(normalizedSessionId, normalizedServerId, 'store-miss'),
                                createRetryingState(result),
                            ),
                        }));
                        scheduleRetry();
                        return;
                    }
                    const hydratedServerId = resolveHydratedServerIdForRouteResult(
                        normalizedSessionId,
                        normalizedServerId,
                        result.serverId,
                    );
                    if (hydratedServerId !== null) {
                        setRouteStateRecord((current) => ({
                            routeKey,
                            state: resolveNextRouteHydrationState(
                                current.routeKey === routeKey ? current.state : createLoadingState(normalizedSessionId, normalizedServerId, 'store-miss'),
                                createAvailableState(normalizedSessionId, hydratedServerId),
                            ),
                        }));
                        return;
                    }
                    setRouteStateRecord((current) => ({
                        routeKey,
                        state: resolveNextRouteHydrationState(
                            current.routeKey === routeKey ? current.state : createLoadingState(normalizedSessionId, normalizedServerId, 'store-miss'),
                            createLoadingState(normalizedSessionId, normalizedServerId, 'refreshing'),
                        ),
                    }));
                    scheduleRetry();
                })
                .catch(() => {
                    if (canceled) return;
                    setRouteStateRecord((current) => ({
                        routeKey,
                        state: resolveNextRouteHydrationState(
                            current.routeKey === routeKey ? current.state : createLoadingState(normalizedSessionId, normalizedServerId, 'store-miss'),
                            withServerId({
                                kind: 'retrying',
                                sessionId: normalizedSessionId,
                                cause: 'unknown',
                            }, normalizedServerId),
                        ),
                    }));
                    scheduleRetry();
                });
        };

        attemptHydration();

        return () => {
            canceled = true;
            if (retryTimeoutId !== null) {
                clearTimeout(retryTimeoutId);
            }
        };
    }, [forceRefresh, hasHydratedSession, normalizedServerId, normalizedSessionId, routeKey, tag]);

    const routeState = routeStateRecord.routeKey === routeKey
        ? routeStateRecord.state
        : createLoadingState(
              normalizedSessionId,
              normalizedServerId,
              normalizedSessionId ? 'store-miss' : 'cold',
          );

    const hydratedAvailableServerId = hasHydratedSession && routeState.kind !== 'missing'
        ? readHydratedRouteServerId(normalizedSessionId, normalizedServerId) ?? normalizedServerId
        : null;
    const hydratedAvailableState = React.useMemo<SessionRouteHydrationState | null>(() => {
        if (hydratedAvailableServerId === null) return null;
        return createAvailableState(normalizedSessionId, hydratedAvailableServerId);
    }, [hydratedAvailableServerId, normalizedSessionId]);

    return hydratedAvailableState ?? routeState;
}
