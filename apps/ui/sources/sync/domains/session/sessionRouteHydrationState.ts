export type SessionRouteHydrationMissingCause =
    | 'not_found'
    | 'unauthorized'
    | 'forbidden'
    | 'auth_unavailable';

export type SessionRouteHydrationRetryCause =
    | 'network'
    | 'server_unavailable'
    | 'decrypting'
    | 'unknown';

export type SessionRouteHydrationState =
    | {
          kind: 'loading';
          sessionId: string;
          serverId?: string;
          reason: 'cold' | 'server-switch' | 'store-miss' | 'refreshing';
      }
    | {
          kind: 'available';
          sessionId: string;
          serverId?: string;
      }
    | {
          kind: 'retrying';
          sessionId: string;
          serverId?: string;
          cause: SessionRouteHydrationRetryCause;
      }
    | {
          kind: 'missing';
          sessionId: string;
          serverId?: string;
          cause: SessionRouteHydrationMissingCause;
      };

export type EnsureSessionVisibleForRouteResult =
    | {
          kind: 'available';
          sessionId: string;
          serverId?: string;
      }
    | {
          kind: 'missing';
          sessionId: string;
          serverId?: string;
          cause: SessionRouteHydrationMissingCause;
      }
    | {
          kind: 'retryable_failure';
          sessionId: string;
          serverId?: string;
          cause: SessionRouteHydrationRetryCause;
      };

export function isSessionRouteHydrationAvailable(state: SessionRouteHydrationState): boolean {
    return state.kind === 'available';
}

export function isSessionRouteHydrationMissing(state: SessionRouteHydrationState): boolean {
    return state.kind === 'missing';
}

export function isSessionRouteHydrationPending(state: SessionRouteHydrationState): boolean {
    return state.kind === 'loading' || state.kind === 'retrying';
}
