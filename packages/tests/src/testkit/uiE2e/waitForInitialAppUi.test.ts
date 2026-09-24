import type { Locator, Page } from '@playwright/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { waitForInitialAppUi, type InitialAppUiPage } from './waitForInitialAppUi';

function createFakePage(params: Readonly<{
  testIdCounts?: Record<string, number[]>;
  selectorCounts?: Record<string, number[]>;
  roleCounts?: Record<string, number[]>;
}>): InitialAppUiPage & Pick<Page, 'locator'> & { reloadCalls: number } {
  const testIdCalls = new Map<string, number>();
  const selectorCalls = new Map<string, number>();
  const roleCalls = new Map<string, number>();
  const testIdCounts = params.testIdCounts ?? {};
  const selectorCounts = params.selectorCounts ?? {};
  const roleCounts = params.roleCounts ?? {};

  const nextCount = (map: Map<string, number>, source: Record<string, number[]>, key: string): number => {
    const idx = map.get(key) ?? 0;
    map.set(key, idx + 1);
    const sequence = source[key] ?? [0];
    return sequence[Math.min(idx, sequence.length - 1)] ?? 0;
  };

  const makeLocator = (key: string, source: Record<string, number[]>, calls: Map<string, number>): Locator => ({
    count: async () => nextCount(calls, source, key),
  } as unknown as Locator);

  const page: InitialAppUiPage & Pick<Page, 'locator'> & { reloadCalls: number } = {
    reloadCalls: 0,
    getByTestId: ((testId) => makeLocator(String(testId), testIdCounts, testIdCalls)) as Page['getByTestId'],
    locator: ((selector) => makeLocator(String(selector), selectorCounts, selectorCalls)) as Page['locator'],
    getByRole: ((_role, options) => makeLocator(String(options?.name ?? ''), roleCounts, roleCalls)) as Page['getByRole'],
    waitForTimeout: async () => {},
    reload: async () => {
      page.reloadCalls += 1;
      return null;
    },
  };

  return page;
}

describe('waitForInitialAppUi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns when welcome UI is already visible', async () => {
    const page = createFakePage({
      testIdCounts: { 'welcome-create-account': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when the unified welcome decision is visible', async () => {
    const page = createFakePage({
      testIdCounts: { 'welcome-primary-start': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when the unified welcome decision is exposed only by role', async () => {
    const page = createFakePage({
      roleCounts: { '/First time here/': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when the mobile brand hero is visible', async () => {
    const page = createFakePage({
      testIdCounts: { 'brand-hero-get-started': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when the unified welcome server-unavailable panel is visible', async () => {
    const page = createFakePage({
      testIdCounts: { 'welcome-server-unavailable': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when provider-based welcome actions are visible', async () => {
    const page = createFakePage({
      testIdCounts: {
        'welcome-signup-provider': [1],
        'welcome-restore': [1],
      },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when the setup relay flow is visible', async () => {
    const page = createFakePage({
      testIdCounts: { 'setup.continueToAuth': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when the post-auth setup screen is visible', async () => {
    const page = createFakePage({
      testIdCounts: { 'setup.postAuth': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when the server-loading welcome state is visible', async () => {
    const page = createFakePage({
      testIdCounts: { 'welcome-server-loading': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when the manual restore path is visible', async () => {
    const page = createFakePage({
      testIdCounts: { 'restore-open-manual': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when an authenticated session list row is visible', async () => {
    const page = createFakePage({
      selectorCounts: { '[data-testid^="session-list-item-"]': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it('returns when the authenticated start-new-session testID is visible', async () => {
    const page = createFakePage({
      testIdCounts: { 'nav-new-session': [1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(0);
  });

  it.each([
    'setupWizard.surface',
    'onboarding-wizard-relay-diagram',
  ])('ignores unsupported startup selector %s', async (testId) => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(60);

    const page = createFakePage({
      testIdCounts: { [testId]: [1, 1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).rejects.toThrow(
      'App did not render initial UI within 50ms.',
    );
    expect(page.reloadCalls).toBe(0);
  });

  it('ignores authenticated start-new-session copy without the stable testID', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(60);

    const page = createFakePage({
      roleCounts: { 'Start New Session': [1, 1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 50, reloadOnFailure: false })).rejects.toThrow(
      'App did not render initial UI within 50ms.',
    );
    expect(page.reloadCalls).toBe(0);
  });

  it('reloads once when the first pass never renders but the retry does', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(300)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0);

    const page = createFakePage({
      testIdCounts: { 'session-composer-input': [0, 1] },
    });

    await expect(waitForInitialAppUi({ page, timeoutMs: 250 })).resolves.toBeUndefined();
    expect(page.reloadCalls).toBe(1);
  });

  it('throws when UI never appears', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(300);

    const page = createFakePage({});

    await expect(
      waitForInitialAppUi({
        page,
        timeoutMs: 250,
        browserDiagnostics: () => '# Browser diagnostics',
      }),
    ).rejects.toThrow('App did not render initial UI within 250ms.');
  });

  it('includes browser diagnostics when UI never appears', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(300);

    await expect(
      waitForInitialAppUi({
        page: createFakePage({}),
        timeoutMs: 250,
        browserDiagnostics: () => '# Browser diagnostics',
      }),
    ).rejects.toThrow('# Browser diagnostics');
  });
});
