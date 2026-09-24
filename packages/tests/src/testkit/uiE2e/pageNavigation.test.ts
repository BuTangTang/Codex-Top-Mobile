import { describe, expect, it, vi } from 'vitest';

import {
  gotoDomContentLoadedWithPathFallback,
  gotoDomContentLoadedWithRetries,
  hasPathname,
  normalizeLoopbackBaseUrl,
} from './pageNavigation';
import * as pageNavigation from './pageNavigation';

describe('gotoDomContentLoadedWithRetries', () => {
  it('retries retryable network errors before succeeding', async () => {
    const goto = vi
      .fn<(_url: string, _options: { waitUntil: 'domcontentloaded'; timeout: number }) => Promise<void>>()
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
      .mockResolvedValueOnce(undefined);
    const waitForTimeout = vi.fn(async () => {});

    const page = {
      goto,
      waitForTimeout,
      url: () => 'about:blank',
    };

    await gotoDomContentLoadedWithRetries(page as never, 'http://localhost:3000');

    expect(goto).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalledWith(500);
  });

  it('retries raw ECONNRESET transport errors before succeeding', async () => {
    const goto = vi
      .fn<(_url: string, _options: { waitUntil: 'domcontentloaded'; timeout: number }) => Promise<void>>()
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce(undefined);
    const waitForTimeout = vi.fn(async () => {});

    const page = {
      goto,
      waitForTimeout,
      url: () => 'about:blank',
    };

    await gotoDomContentLoadedWithRetries(page as never, 'http://localhost:3000');

    expect(goto).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalledWith(500);
  });

  it('does not treat a timed-out DOM-content navigation as usable based only on current URL equality', async () => {
    const targetUrl = 'http://localhost:3000/';
    const goto = vi.fn(async () => {
      throw new Error('page.goto: Timeout 90000ms exceeded.');
    });

    const page = {
      goto,
      waitForTimeout: vi.fn(async () => {}),
      url: () => targetUrl,
    };

    await expect(gotoDomContentLoadedWithRetries(page as never, targetUrl)).rejects.toThrow(/Timeout/);
    expect(goto).toHaveBeenCalledTimes(1);
  });

  it('treats a timed-out navigation as usable once the expected pathname has committed', async () => {
    const targetUrl = 'http://localhost:3000/?server=http%3A%2F%2F127.0.0.1%3A1';
    const goto = vi.fn(async () => {
      throw new Error('page.goto: Timeout 90000ms exceeded.');
    });

    const page = {
      goto,
      waitForTimeout: vi.fn(async () => {}),
      url: () => 'http://localhost:3000/',
    };

    await expect(gotoDomContentLoadedWithPathFallback(page as never, targetUrl, '/')).resolves.toBeUndefined();
    expect(goto).toHaveBeenCalledTimes(1);
  });
});

describe('gotoCommittedWithRetries', () => {
  it('retries retryable network errors before succeeding', async () => {
    const goto = vi
      .fn<(_url: string, _options: { waitUntil: 'commit'; timeout: number }) => Promise<void>>()
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
      .mockResolvedValueOnce(undefined);
    const waitForTimeout = vi.fn(async () => {});

    type PageStub = {
      goto: typeof goto;
      waitForTimeout: typeof waitForTimeout;
      url: () => string;
    };

    const page: PageStub = {
      goto,
      waitForTimeout,
      url: () => 'about:blank',
    };

    const helper = (pageNavigation as Record<string, unknown>).gotoCommittedWithRetries;
    expect(helper).toBeTypeOf('function');
    await expect((helper as (page: PageStub, url: string, timeoutMs?: number) => Promise<void>)(page, 'http://localhost:3000')).resolves.toBeUndefined();

    expect(goto).toHaveBeenCalledTimes(2);
    expect(waitForTimeout).toHaveBeenCalledWith(500);
  });

  it('treats a timed-out navigation as usable once the target URL has committed', async () => {
    const targetUrl = 'http://localhost:3000/';
    const goto = vi.fn(async () => {
      throw new Error('page.goto: Timeout 90000ms exceeded.');
    });

    const waitForTimeout = vi.fn(async () => {});
    type PageStub = {
      goto: typeof goto;
      waitForTimeout: typeof waitForTimeout;
      url: () => string;
    };

    const page: PageStub = {
      goto,
      waitForTimeout,
      url: () => targetUrl,
    };

    const helper = (pageNavigation as Record<string, unknown>).gotoCommittedWithRetries;
    expect(helper).toBeTypeOf('function');
    await expect((helper as (page: PageStub, url: string, timeoutMs?: number) => Promise<void>)(page, targetUrl)).resolves.toBeUndefined();
    expect(goto).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeLoopbackBaseUrl', () => {
  it('preserves routable IPv4 loopback hosts and rewrites non-routable loopback hosts to 127.0.0.1', () => {
    expect(normalizeLoopbackBaseUrl('http://localhost:60674/')).toBe('http://127.0.0.1:60674');
    expect(normalizeLoopbackBaseUrl('http://127.0.0.1:60674/')).toBe('http://127.0.0.1:60674');
    expect(normalizeLoopbackBaseUrl('http://0.0.0.0:60674/')).toBe('http://127.0.0.1:60674');
    expect(normalizeLoopbackBaseUrl('http://[::1]:60674/')).toBe('http://127.0.0.1:60674');
  });
});

describe('hasPathname', () => {
  it('matches the same route across loopback host variants', () => {
    expect(hasPathname('http://127.0.0.1:49801/v1/auth/external/github/finalize-keyless', '/v1/auth/external/github/finalize-keyless')).toBe(true);
    expect(hasPathname('http://localhost:49801/v1/auth/external/github/finalize-keyless', '/v1/auth/external/github/finalize-keyless')).toBe(true);
  });

  it('returns false for a different pathname', () => {
    expect(hasPathname('http://localhost:49801/v1/auth/external/github/params', '/v1/auth/external/github/finalize-keyless')).toBe(false);
  });
});
