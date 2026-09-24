import { afterEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';

function makeRenderableSession(
  id: string,
  overrides: Partial<SessionListRenderableSession> = {},
): SessionListRenderableSession {
  return {
    id,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    active: false,
    activeAt: 1,
    archivedAt: null,
    metadataVersion: 1,
    agentStateVersion: 0,
    metadata: null,
    thinking: false,
    thinkingAt: 0,
    presence: 1,
    ...overrides,
  };
}

describe('useHasUnreadMessages', () => {
  afterEach(() => {
    storage.setState({
      sessions: {},
      sessionListRenderables: {},
      sessionMessages: {},
      sessionPending: {},
      isDataReady: true,
    } as never);
    standardCleanup();
  });

  it('uses session-list row unread state when the full session is not hydrated', async () => {
    storage.setState({
      sessions: {},
      sessionListRenderables: {
        s1: makeRenderableSession('s1', { hasUnreadMessages: true }),
      },
      isDataReady: true,
    } as never);

    const { useHasUnreadMessages } = await import('./hooks');
    const hook = await renderHook(() => useHasUnreadMessages('s1'));

    expect(hook.getCurrent()).toBe(true);
    await hook.unmount();
  });

  it('does not report unread when only trailing non-displayable session activity is newer than the cursor', async () => {
    storage.setState({
      sessions: {
        s1: {
          id: 's1',
          seq: 946,
          lastViewedSessionSeq: 945,
          latestTurnStatus: 'in_progress',
          metadata: null,
        },
      },
      sessionMessages: {
        s1: {
          messageIdsOldestFirst: ['m-visible'],
          messagesById: {
            'm-visible': {
              id: 'm-visible',
              kind: 'agent-text',
              seq: 945,
              localId: null,
              createdAt: 1,
              text: 'Visible assistant message',
            },
          },
        },
      },
      sessionListRenderables: {},
      sessionPending: {},
      isDataReady: true,
    } as never);

    const { useHasUnreadMessages } = await import('./hooks');
    const hook = await renderHook(() => useHasUnreadMessages('s1'));

    expect(hook.getCurrent()).toBe(false);
    await hook.unmount();
  });

  it('does not report unread when only provider maintenance events are newer than the cursor', async () => {
    storage.setState({
      sessions: {
        s1: {
          id: 's1',
          seq: 946,
          lastViewedSessionSeq: 945,
          latestTurnStatus: 'in_progress',
          metadata: null,
        },
      },
      sessionMessages: {
        s1: {
          messageIdsOldestFirst: ['m-visible', 'm-provider-state'],
          messagesById: {
            'm-visible': {
              id: 'm-visible',
              kind: 'agent-text',
              seq: 945,
              localId: null,
              createdAt: 1,
              text: 'Visible assistant message',
            },
            'm-provider-state': {
              id: 'm-provider-state',
              kind: 'agent-event',
              seq: 946,
              createdAt: 2,
              event: {
                type: 'provider-state-sharing-degraded',
                serviceId: 'anthropic',
                requestedStateMode: 'shared',
                effectiveStateMode: 'isolated',
                code: 'state_symlink_unavailable',
              },
            },
          },
          isLoaded: true,
        },
      },
      sessionListRenderables: {},
      sessionPending: {},
      isDataReady: true,
    } as never);

    const { useHasUnreadMessages } = await import('./hooks');
    const hook = await renderHook(() => useHasUnreadMessages('s1'));

    expect(hook.getCurrent()).toBe(false);
    await hook.unmount();
  });

  it('does not report unread from raw session seq when the transcript bucket is not loaded', async () => {
    storage.setState({
      sessions: {
        s1: {
          id: 's1',
          seq: 946,
          lastViewedSessionSeq: 945,
          latestTurnStatus: 'in_progress',
          metadata: null,
        },
      },
      sessionMessages: {
        s1: {
          isLoaded: false,
        },
      },
      sessionListRenderables: {},
      sessionPending: {},
      isDataReady: true,
    } as never);

    const { useHasUnreadMessages } = await import('./hooks');
    const hook = await renderHook(() => useHasUnreadMessages('s1'));

    expect(hook.getCurrent()).toBe(false);
    await hook.unmount();
  });

  it('preserves known renderable unread when a hydrated session has an unknown transcript bucket', async () => {
    storage.setState({
      sessions: {
        s1: {
          id: 's1',
          seq: 946,
          lastViewedSessionSeq: 945,
          latestTurnStatus: 'in_progress',
          metadata: null,
        },
      },
      sessionMessages: {
        s1: {
          isLoaded: false,
        },
      },
      sessionListRenderables: {
        s1: makeRenderableSession('s1', { hasUnreadMessages: true }),
      },
      sessionPending: {},
      isDataReady: true,
    } as never);

    const { useHasUnreadMessages } = await import('./hooks');
    const unreadHook = await renderHook(() => useHasUnreadMessages('s1'));

    expect(unreadHook.getCurrent()).toBe(true);
    await unreadHook.unmount();
  });

  it('reports unread from ready seq when the transcript bucket is not loaded', async () => {
    storage.setState({
      sessions: {
        s1: {
          id: 's1',
          seq: 946,
          lastViewedSessionSeq: 945,
          latestReadyEventSeq: 946,
          latestReadyEventAt: 2_000,
          latestTurnStatus: 'in_progress',
          metadata: null,
        },
      },
      sessionMessages: {
        s1: {
          isLoaded: false,
        },
      },
      sessionListRenderables: {},
      sessionPending: {},
      isDataReady: true,
    } as never);

    const { useHasUnreadMessages } = await import('./hooks');
    const hook = await renderHook(() => useHasUnreadMessages('s1'));

    expect(hook.getCurrent()).toBe(true);
    await hook.unmount();
  });

  it('reads ready metadata from hydrated session rows before transcript and renderable state catch up', async () => {
    storage.setState({
      sessions: {
        s1: {
          id: 's1',
          seq: 10,
          latestReadyEventSeq: 10,
          latestReadyEventAt: 2_000,
          metadata: null,
        },
      },
      sessionMessages: {},
      sessionListRenderables: {},
      sessionPending: {},
      isDataReady: true,
    } as never);

    const { useSessionReadyActivity } = await import('./hooks');
    const hook = await renderHook(() => useSessionReadyActivity('s1'));

    expect(hook.getCurrent()).toEqual({
      latestReadyEventSeq: 10,
      latestReadyEventAt: 2_000,
    });
    await hook.unmount();
  });

});
