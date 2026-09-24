export type DeferredSessionStateHydrationState = Readonly<{
    sessionIds: Readonly<Record<string, true>>;
}>;

export function createDeferredSessionStateHydrationState(): DeferredSessionStateHydrationState {
    return { sessionIds: {} };
}

export function markSessionStateHydrationDeferred(
    state: DeferredSessionStateHydrationState,
    sessionId: string,
): DeferredSessionStateHydrationState {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId || state.sessionIds[normalizedSessionId]) return state;
    return {
        sessionIds: {
            ...state.sessionIds,
            [normalizedSessionId]: true,
        },
    };
}

export function hasDeferredSessionStateHydration(
    state: DeferredSessionStateHydrationState,
    sessionId: string,
): boolean {
    const normalizedSessionId = String(sessionId ?? '').trim();
    return Boolean(normalizedSessionId && state.sessionIds[normalizedSessionId]);
}

export function clearDeferredSessionStateHydration(
    state: DeferredSessionStateHydrationState,
    sessionId: string,
): DeferredSessionStateHydrationState {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId || !state.sessionIds[normalizedSessionId]) return state;
    const { [normalizedSessionId]: _cleared, ...sessionIds } = state.sessionIds;
    return { sessionIds };
}
