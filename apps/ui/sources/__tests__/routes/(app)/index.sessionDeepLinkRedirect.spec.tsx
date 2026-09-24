import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import { flushHookEffects, renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
  routerReplaceSpy: vi.fn(),
  authenticated: true,
  activeServerId: 'server-a',
  searchParams: { id: 'session-1', messageId: 'message-1' } as { id?: string; messageId?: string; jumpChildId?: string; serverId?: string; authReturn?: string },
}));

vi.mock('expo-router', async () => {
  const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
  const routerMock = createExpoRouterMock({
    params: shared.searchParams,
    router: {
      push: vi.fn(),
      back: vi.fn(),
      replace: shared.routerReplaceSpy,
      setParams: vi.fn(),
    },
  });

  return {
    ...routerMock.module,
    useLocalSearchParams: () => shared.searchParams,
    useGlobalSearchParams: () => shared.searchParams,
  };
});

vi.mock('react-native-reanimated', async () => {
  const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
  return createReanimatedModuleMock();
});
vi.mock('react-native-typography', () => ({ iOSUIKit: { title3: {} } }));
vi.mock('@shopify/react-native-skia', () => ({}));
vi.mock('@/components/navigation/shell/HomeHeader', () => ({ HomeHeaderNotAuth: () => null }));
vi.mock('@/components/navigation/shell/MainView', () => ({ MainView: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => ({ serverId: shared.activeServerId }) }));

vi.mock('@/auth/context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: shared.authenticated,
    credentials: { token: 't', secret: new Uint8Array([1]) },
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
  }),
}));

vi.mock('@/encryption/base64', () => ({
  encodeBase64: () => 'x',
}));

vi.mock('@/encryption/libsodium.lib', () => ({ default: {} }));

describe('/ authenticated deep link redirects', () => {
  it('redirects to /session/:id/message/:messageId when query params are present', async () => {
    vi.resetModules();
    shared.routerReplaceSpy.mockClear();
    shared.searchParams = { id: 'session-1', messageId: 'message-1' };

    const { default: Screen } = await import('@/app/(app)/index');
    let tree: renderer.ReactTestRenderer | null = null;

    try {
      tree = (await renderScreen(<Screen />)).tree;
      await flushHookEffects();

      expect(shared.routerReplaceSpy).toHaveBeenCalledWith('/session/session-1/message/message-1');
    } finally {
      act(() => {
        tree?.unmount();
      });
    }
  });

  it('preserves serverId when redirecting deep links from /', async () => {
    vi.resetModules();
    shared.routerReplaceSpy.mockClear();
    shared.searchParams = { id: 'session-1', messageId: 'message-1', serverId: 'server-a' };

    const { default: Screen } = await import('@/app/(app)/index');
    let tree: renderer.ReactTestRenderer | null = null;

    try {
      tree = (await renderScreen(<Screen />)).tree;
      await flushHookEffects();

      expect(shared.routerReplaceSpy).toHaveBeenCalledWith('/session/session-1/message/message-1?serverId=server-a');
    } finally {
      act(() => {
        tree?.unmount();
      });
    }
  });

  it('does not collapse a non-root web deep link to the session root', async () => {
    vi.resetModules();
    shared.routerReplaceSpy.mockClear();
    shared.searchParams = { id: 'session-1' };

    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          pathname: '/session/session-1/message/message-1',
        },
      },
    });

    try {
      const { default: Screen } = await import('@/app/(app)/index');
      let tree: renderer.ReactTestRenderer | null = null;

      try {
        tree = (await renderScreen(<Screen />)).tree;
        await flushHookEffects();

        expect(shared.routerReplaceSpy).not.toHaveBeenCalled();
      } finally {
        act(() => {
          tree?.unmount();
        });
      }
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it('preserves jumpChildId when redirecting to /session/:id (no messageId)', async () => {
    vi.resetModules();
    shared.routerReplaceSpy.mockClear();
    shared.searchParams = { id: 'session-1', serverId: 'server-a', jumpChildId: 'child-1' };

    const { default: Screen } = await import('@/app/(app)/index');
    let tree: renderer.ReactTestRenderer | null = null;

    try {
      tree = (await renderScreen(<Screen />)).tree;
      await flushHookEffects();

      expect(shared.routerReplaceSpy).toHaveBeenCalledWith('/session/session-1?serverId=server-a&jumpChildId=child-1');
    } finally {
      act(() => {
        tree?.unmount();
      });
    }
  });
});

describe('登录后的通知目标', () => {
  it.each(['server-a', 'server-b'])('只在实际登录服务器一致时恢复：%s', async (activeServerId) => {
    vi.resetModules();
    shared.routerReplaceSpy.mockClear();
    shared.activeServerId = activeServerId;
    shared.searchParams = { id: 'same', serverId: 'server-b', authReturn: '1' };
    const { default: Screen } = await import('@/app/(app)/index');
    const screen = await renderScreen(<Screen />);
    await flushHookEffects();
    expect(shared.routerReplaceSpy).toHaveBeenCalledWith(activeServerId === 'server-b' ? '/session/same?serverId=server-b' : '/');
    await screen.unmount();
    shared.activeServerId = 'server-a';
  });
});
