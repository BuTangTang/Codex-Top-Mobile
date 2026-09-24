import { getSessionName } from '@/utils/sessions/sessionUtils';
import {
    deriveSessionRuntimePresentationState,
    readFreshInProgressRuntimeSignalTimestamps,
    SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS,
    type SessionRuntimePresentationState,
} from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import {
    deriveLatestPendingRequestObservedAtFromSession,
} from '@/sync/domains/session/pending/listPendingSessionRequests';

import {
    PET_COMPANION_ACTIVITY_EXPIRY_MS,
    PET_COMPANION_ACTIVITY_PRIORITY,
} from './petCompanionActivityConstants';
import type {
    BuildPetCompanionActivityModelInput,
    PetCompanionActivitySession,
    PetCompanionActivityModel,
    PetCompanionActivityStatus,
    PetCompanionSessionSignals,
    PetCompanionTrayItem,
} from './petCompanionActivityTypes';

type SessionActivityCandidate = Readonly<{
    session: PetCompanionActivitySession;
    status: Exclude<PetCompanionActivityStatus, 'idle'>;
    activityAtMs: number | null;
    expiresAtMs: number | null;
}>;

function normalizeDismissedKeys(input: BuildPetCompanionActivityModelInput): ReadonlySet<string> {
    const keys = input.dismissedTrayItemKeys;
    if (!keys) return new Set<string>();
    return keys instanceof Set ? keys : new Set(keys);
}

function isFiniteTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveTimestamp(value: unknown): value is number {
    return isFiniteTimestamp(value) && value > 0;
}

function latestTimestamp(values: readonly unknown[]): number | null {
    let latest: number | null = null;
    for (const value of values) {
        if (!isPositiveTimestamp(value)) continue;
        latest = latest === null ? value : Math.max(latest, value);
    }
    return latest;
}

function hasWaitingActivity(
    session: PetCompanionActivitySession,
    signals: PetCompanionSessionSignals | undefined,
    runtimeStatus: SessionRuntimePresentationState,
): boolean {
    const pendingPermissionRequestCount =
        'pendingPermissionRequestCount' in session ? session.pendingPermissionRequestCount ?? 0 : 0;
    const pendingUserActionRequestCount =
        'pendingUserActionRequestCount' in session ? session.pendingUserActionRequestCount ?? 0 : 0;
    const hasPendingPermissionRequests =
        pendingPermissionRequestCount > 0
        || signals?.hasPendingPermissionRequests === true;
    const hasPendingUserActionRequests =
        pendingUserActionRequestCount > 0
        || signals?.hasPendingUserActionRequests === true;

    return (
        (hasPendingPermissionRequests && runtimeStatus.freshPermissionRequired)
        || (hasPendingUserActionRequests && runtimeStatus.freshActionRequired)
    );
}

function latestConversationActivityTimestamp(
    session: PetCompanionActivitySession,
    signals: PetCompanionSessionSignals | undefined,
): number | null {
    return latestTimestamp([
        signals?.latestMeaningfulActivityAtMs,
        signals?.latestThinkingActivityAtMs,
        session.thinkingAt,
        session.optimisticThinkingAt,
        session.createdAt,
    ]);
}

function hasProjectedFailure(session: PetCompanionActivitySession): boolean {
    return session.latestTurnStatus === 'failed' || session.lastRuntimeIssue?.status === 'failed';
}

function latestProjectedFailureTimestamp(session: PetCompanionActivitySession): number | null {
    return latestTimestamp([
        session.lastRuntimeIssue?.occurredAt,
        session.latestTurnStatus === 'failed' ? session.latestTurnStatusObservedAt : null,
    ]);
}

function derivePendingRequestObservedAt(
    session: PetCompanionActivitySession,
): number | null {
    if ('pendingRequestObservedAt' in session) {
        return isPositiveTimestamp(session.pendingRequestObservedAt) ? session.pendingRequestObservedAt : null;
    }
    if ('agentState' in session) {
        return deriveLatestPendingRequestObservedAtFromSession(session);
    }
    return null;
}

function resolveRuntimeStatusNowMs(
    session: PetCompanionActivitySession,
    signals: PetCompanionSessionSignals | undefined,
    nowMs: number | undefined,
): number {
    if (isFiniteTimestamp(nowMs)) return nowMs;
    return latestTimestamp([
        signals?.latestThinkingActivityAtMs,
        session.thinkingAt,
        session.latestTurnStatusObservedAt,
        session.createdAt,
    ]) ?? 0;
}

function resolveRunningExpiresAtMs(
    session: PetCompanionActivitySession,
    signals: PetCompanionSessionSignals | undefined,
    runtimeNowMs: number,
): number {
    const thinkingAt = isPositiveTimestamp(session.thinkingAt)
        ? session.thinkingAt
        : null;
    const runtimeSignalAtMs = latestTimestamp([
        signals?.latestThinkingActivityAtMs,
        thinkingAt,
        ...readFreshInProgressRuntimeSignalTimestamps(session, runtimeNowMs),
    ]) ?? runtimeNowMs;

    return runtimeSignalAtMs + SESSION_RUNTIME_STATUS_STALE_SIGNAL_MS;
}

function resolveCandidate(
    session: PetCompanionActivitySession,
    signals: PetCompanionSessionSignals | undefined,
    nowMs: number | undefined,
): SessionActivityCandidate | null {
    const pendingPermissionRequestCount =
        'pendingPermissionRequestCount' in session ? session.pendingPermissionRequestCount ?? 0 : 0;
    const pendingUserActionRequestCount =
        'pendingUserActionRequestCount' in session ? session.pendingUserActionRequestCount ?? 0 : 0;
    const runtimeNowMs = resolveRuntimeStatusNowMs(session, signals, nowMs);
    const runtimeStatus = deriveSessionRuntimePresentationState({
        ...session,
        hasPendingPermissionRequests:
            pendingPermissionRequestCount > 0
            || signals?.hasPendingPermissionRequests === true,
        hasPendingUserActionRequests:
            pendingUserActionRequestCount > 0
            || signals?.hasPendingUserActionRequests === true,
        pendingRequestObservedAt: derivePendingRequestObservedAt(session),
    }, runtimeNowMs);

    if (hasWaitingActivity(session, signals, runtimeStatus)) {
        const activityAtMs = latestConversationActivityTimestamp(session, signals);
        return {
            session,
            status: 'waiting',
            activityAtMs,
            expiresAtMs: activityAtMs === null ? null : activityAtMs + PET_COMPANION_ACTIVITY_EXPIRY_MS.waiting,
        };
    }

    if (hasProjectedFailure(session)) {
        const activityAtMs =
            latestProjectedFailureTimestamp(session)
            ?? latestConversationActivityTimestamp(session, signals);
        return {
            session,
            status: 'failed',
            activityAtMs,
            expiresAtMs: activityAtMs === null ? null : activityAtMs + PET_COMPANION_ACTIVITY_EXPIRY_MS.failed,
        };
    }

    if (runtimeStatus.working) {
        const activityAtMs = latestTimestamp([
            signals?.latestThinkingActivityAtMs,
            session.thinkingAt,
            session.createdAt,
        ]);
        return {
            session,
            status: 'running',
            activityAtMs,
            expiresAtMs: resolveRunningExpiresAtMs(session, signals, runtimeNowMs),
        };
    }

    if (signals?.hasUnreadMessages) {
        const activityAtMs = latestConversationActivityTimestamp(session, signals);
        return {
            session,
            status: 'waiting',
            activityAtMs,
            expiresAtMs: null,
        };
    }

    return null;
}

function isExpired(candidate: SessionActivityCandidate, nowMs: number | undefined): boolean {
    if (!isFiniteTimestamp(nowMs)) return false;
    return candidate.expiresAtMs !== null && nowMs > candidate.expiresAtMs;
}

function createDismissKey(candidate: SessionActivityCandidate): string {
    if (candidate.status === 'running' || candidate.expiresAtMs === null) {
        return [
            candidate.status,
            candidate.session.id,
            'live',
        ].join(':');
    }

    return [
        candidate.status,
        candidate.session.id,
        candidate.activityAtMs === null ? 'live' : String(candidate.activityAtMs),
    ].join(':');
}

function createTrayItem(
    candidate: SessionActivityCandidate,
    signals: PetCompanionSessionSignals | undefined,
): PetCompanionTrayItem {
    const dismissKey = createDismissKey(candidate);
    const isLiveActivity = candidate.status === 'running' || candidate.expiresAtMs === null;
    return {
        id: dismissKey,
        dismissKey,
        sessionId: candidate.session.id,
        status: candidate.status,
        priority: PET_COMPANION_ACTIVITY_PRIORITY[candidate.status],
        title: getSessionName(candidate.session),
        subtitle: isLiveActivity && candidate.status === 'running'
            ? null
            : signals?.lastMessageSubtitle ?? null,
        activityAtMs: isLiveActivity ? null : candidate.activityAtMs,
        expiresAtMs: candidate.expiresAtMs,
        actions: {
            open: true,
            dismiss: true,
            quickReply: true,
        },
    };
}

function compareTrayItems(a: PetCompanionTrayItem, b: PetCompanionTrayItem): number {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aActivity = a.activityAtMs ?? Number.NEGATIVE_INFINITY;
    const bActivity = b.activityAtMs ?? Number.NEGATIVE_INFINITY;
    if (aActivity !== bActivity) return bActivity - aActivity;
    return a.sessionId.localeCompare(b.sessionId);
}

function selectFallbackSession(input: BuildPetCompanionActivityModelInput): PetCompanionActivitySession | null {
    const selectedId = typeof input.selectedSessionId === 'string' ? input.selectedSessionId : '';
    if (selectedId) {
        const selected = input.sessions.find((session) => session.id === selectedId);
        if (selected) return selected;
    }
    return input.sessions.find((session) => session.active) ?? input.sessions[0] ?? null;
}

export function buildPetCompanionActivityModel(
    input: BuildPetCompanionActivityModelInput,
): PetCompanionActivityModel {
    const nowMs = isFiniteTimestamp(input.nowMs) ? input.nowMs : Date.now();
    const dismissedKeys = normalizeDismissedKeys(input);
    const trayItems = input.sessions
        .map((session) => {
            const signals = input.signalsBySessionId?.[session.id];
            const candidate = resolveCandidate(session, signals, nowMs);
            return candidate ? { candidate, signals } : null;
        })
        .filter((entry): entry is Readonly<{
            candidate: SessionActivityCandidate;
            signals: PetCompanionSessionSignals | undefined;
        }> => entry !== null)
        .filter(({ candidate }) => !isExpired(candidate, nowMs))
        .map(({ candidate, signals }) => createTrayItem(candidate, signals))
        .filter((item) => !dismissedKeys.has(item.dismissKey))
        .sort(compareTrayItems);
    const primary = trayItems[0] ?? null;

    if (primary) {
        return {
            state: primary.status,
            reason: primary.status,
            sessionId: primary.sessionId,
            trayItems,
        };
    }

    const fallbackSession = selectFallbackSession(input);
    return {
        state: 'idle',
        reason: 'idle',
        sessionId: fallbackSession?.id ?? null,
        trayItems,
    };
}
