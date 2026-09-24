import type { Page } from '@playwright/test';

const AUTHENTICATED_ROUTE_REVISIT_INTERVAL_MS = 1_000;

export function normalizeLoopbackBaseUrl(input: string): string {
  try {
    const parsed = new URL(input);
    // Keep browser navigation on a routable IPv4 loopback. Some local environments resolve
    // `localhost` to IPv6 first, while these test servers only listen on 127.0.0.1.
    if (
      parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '0.0.0.0'
      || parsed.hostname === '::1'
      || parsed.hostname === '[::1]'
    ) {
      const port = parsed.port ? `:${parsed.port}` : '';
      return `${parsed.protocol}//127.0.0.1${port}${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/\/+$/, '');
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return input.replace(/\/+$/, '');
  }
}

export async function gotoDomContentLoadedWithRetries(page: Page, url: string, timeoutMs = 90_000): Promise<void> {
  await gotoWithRetries(page, url, timeoutMs, 'domcontentloaded');
}

export async function gotoCommittedWithRetries(page: Page, url: string, timeoutMs = 90_000): Promise<void> {
  await gotoWithRetries(page, url, timeoutMs, 'commit');
}

async function gotoWithRetries(page: Page, url: string, timeoutMs: number, waitUntil: 'commit' | 'domcontentloaded'): Promise<void> {
  const normalizeUrl = (value: string): string => value.replace(/\/+$/, '');
  const targetUrl = normalizeUrl(url);
  const retryable = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('net::ERR_NETWORK_CHANGED')
      || message.includes('net::ERR_CONNECTION_REFUSED')
      || message.includes('net::ERR_CONNECTION_RESET')
      || message.includes('ECONNRESET')
      || message.includes('net::ERR_ABORTED')
    );
  };

  const isCommittedTimeout = (error: unknown): boolean => {
    if (waitUntil !== 'commit') return false;
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('timeout')) return false;
    return normalizeUrl(page.url()) === targetUrl;
  };

  const start = Date.now();
  let attempt = 0;
  // Metro can briefly restart or drop connections during bundling; retry a few times for stability.
  while (attempt < 4) {
    attempt += 1;
    try {
      const remaining = Math.max(5_000, timeoutMs - (Date.now() - start));
      await page.goto(url, { waitUntil, timeout: remaining });
      return;
    } catch (error) {
      if (isCommittedTimeout(error)) return;
      if (attempt >= 4 || !retryable(error)) throw error;
      await page.waitForTimeout(500 * attempt);
    }
  }
}

function normalizePathname(value: string): string {
  if (!value) return '/';
  let pathname = value.trim();
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/+$/, '');
  return pathname || '/';
}

export function hasPathname(url: string, expectedPathname: string): boolean {
  try {
    return normalizePathname(new URL(url).pathname) === normalizePathname(expectedPathname);
  } catch {
    return false;
  }
}

export function isGotoTimeoutOnExpectedPath(page: Page, expectedPathname: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.toLowerCase().includes('timeout')) return false;
  return hasPathname(page.url(), expectedPathname);
}

export async function gotoDomContentLoadedWithPathFallback(
  page: Page,
  url: string,
  expectedPathname: string,
  timeoutMs = 90_000,
): Promise<void> {
  try {
    await gotoDomContentLoadedWithRetries(page, url, timeoutMs);
  } catch (error) {
    if (isGotoTimeoutOnExpectedPath(page, expectedPathname, error)) return;
    throw error;
  }
}

export async function waitForAuthenticatedRouteUi(params: Readonly<{
  page: Page;
  expectedPathname: string;
  requiredTestIds: readonly string[];
  blockedTestIds?: readonly string[] | undefined;
  targetUrl?: string | undefined;
  timeoutMs?: number;
  browserDiagnostics?: (() => string) | undefined;
  reloadOnFailure?: boolean | undefined;
}>): Promise<void> {
  const timeoutMs = typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
    ? params.timeoutMs
    : 120_000;
  const reloadOnFailure = params.reloadOnFailure !== false;
  const expectedPathname = normalizePathname(params.expectedPathname);
  const requiredTestIds = params.requiredTestIds.filter((value) => typeof value === 'string' && value.trim().length > 0);
  const blockedTestIds = (params.blockedTestIds ?? ['welcome-create-account'])
    .filter((value) => typeof value === 'string' && value.trim().length > 0);

  if (requiredTestIds.length === 0) {
    throw new Error('waitForAuthenticatedRouteUi requires at least one required test id.');
  }

  const initialTargetUrl = params.targetUrl ?? params.page.url();

  const waitForRouteUiOnce = async (): Promise<void> => {
    const startedAt = Date.now();
    let lastTargetNavigationAt = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const now = Date.now();
      let pathname: string;
      try {
        pathname = normalizePathname(new URL(params.page.url()).pathname);
      } catch {
        pathname = '';
      }

      if (pathname !== expectedPathname) {
        if (
          params.targetUrl
          && hasPathname(params.targetUrl, expectedPathname)
          && now - lastTargetNavigationAt >= AUTHENTICATED_ROUTE_REVISIT_INTERVAL_MS
        ) {
          lastTargetNavigationAt = now;
          const remainingTimeoutMs = Math.max(1, timeoutMs - (now - startedAt));
          await gotoDomContentLoadedWithPathFallback(
            params.page,
            params.targetUrl,
            expectedPathname,
            remainingTimeoutMs,
          );
          continue;
        }
        await params.page.waitForTimeout(250);
        continue;
      }

      const blockedCounts = await Promise.all(blockedTestIds.map((testId) => params.page.getByTestId(testId).count()));
      const requiredCounts = await Promise.all(requiredTestIds.map((testId) => params.page.getByTestId(testId).count()));
      const blockedVisible = blockedCounts.some((count) => count > 0);
      const requiredVisible = requiredCounts.every((count) => count > 0);

      if (!blockedVisible && requiredVisible) {
        return;
      }

      await params.page.waitForTimeout(250);
    }

    const diagnostics = params.browserDiagnostics ? `\n\n${params.browserDiagnostics()}` : '';
    throw new Error(
      `App did not reach the authenticated route UI for ${expectedPathname} within ${timeoutMs}ms.${diagnostics}`,
    );
  };

  try {
    await waitForRouteUiOnce();
  } catch (error) {
    if (!reloadOnFailure) throw error;
    if (hasPathname(initialTargetUrl, expectedPathname) && !hasPathname(params.page.url(), expectedPathname)) {
      await gotoDomContentLoadedWithPathFallback(params.page, initialTargetUrl, expectedPathname, timeoutMs);
    } else {
      await params.page.reload({ waitUntil: 'domcontentloaded' });
    }
    await waitForRouteUiOnce();
  }
}
