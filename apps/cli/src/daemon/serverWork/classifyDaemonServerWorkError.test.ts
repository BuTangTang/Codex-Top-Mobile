import { describe, expect, it } from 'vitest';

import { createHttpStatusError } from '../../api/client/httpStatusError';
import { ConnectedServiceQuotaApiError } from '../../api/connectedServices/connectedServiceQuotaApiError';

type Classification = Readonly<{
  kind: string;
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
}>;

type ClassifierModule = {
  classifyDaemonServerWorkError?: (
    error: unknown,
    options?: Readonly<{ featureAbsentStatusCodes?: readonly number[] }>,
  ) => Classification;
};

async function loadClassifierModule(): Promise<ClassifierModule> {
  try {
    const path = './classifyDaemonServerWorkError';
    return (await import(path)) as unknown as ClassifierModule;
  } catch {
    return {};
  }
}

describe('classifyDaemonServerWorkError', () => {
  it('surfaces auth failures distinctly from transient network failures', async () => {
    const mod = await loadClassifierModule();

    expect(mod.classifyDaemonServerWorkError).toEqual(expect.any(Function));

    const classify = mod.classifyDaemonServerWorkError!;

    expect(classify(createHttpStatusError(401, 'auth expired'))).toMatchObject({
      kind: 'auth_failed',
      retryable: false,
      statusCode: 401,
    });

    expect(classify({ code: 'ECONNRESET' })).toMatchObject({
      kind: 'network',
      retryable: true,
    });
  });

  it('honors retry-after for rate-limited server work', async () => {
    const mod = await loadClassifierModule();

    expect(mod.classifyDaemonServerWorkError).toEqual(expect.any(Function));

    const classify = mod.classifyDaemonServerWorkError!;
    const classification = classify({
      response: {
        status: 429,
        headers: { 'retry-after': '3' },
      },
    });

    expect(classification).toMatchObject({
      kind: 'rate_limited',
      retryable: true,
      statusCode: 429,
      retryAfterMs: 3000,
    });
  });

  it('classifies connected-service quota API rate limits from preserved error fields', async () => {
    const mod = await loadClassifierModule();

    expect(mod.classifyDaemonServerWorkError).toEqual(expect.any(Function));

    const classify = mod.classifyDaemonServerWorkError!;
    const classification = classify(new ConnectedServiceQuotaApiError({
      message: 'quota write failed',
      kind: 'retryable',
      status: 429,
      retryable: true,
      retryAfterMs: 7000,
    }));

    expect(classification).toMatchObject({
      kind: 'rate_limited',
      retryable: true,
      statusCode: 429,
      retryAfterMs: 7000,
    });
  });

  it('classifies wrapped connected-service quota transport timeouts as retryable timeouts', async () => {
    const mod = await loadClassifierModule();

    expect(mod.classifyDaemonServerWorkError).toEqual(expect.any(Function));

    const classify = mod.classifyDaemonServerWorkError!;
    const classification = classify(new ConnectedServiceQuotaApiError({
      message: 'Failed to register connected service quota snapshot',
      kind: 'retryable',
      status: null,
      retryable: true,
      cause: {
        code: 'ECONNABORTED',
        message: 'timeout of 5000ms exceeded',
      },
    }));

    expect(classification).toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
  });

  it('treats wrapped timeout messages without preserved codes as retryable timeouts', async () => {
    const mod = await loadClassifierModule();

    expect(mod.classifyDaemonServerWorkError).toEqual(expect.any(Function));

    const classify = mod.classifyDaemonServerWorkError!;

    expect(classify(new Error('Failed to get account encryption mode: timeout of 5000ms exceeded'))).toMatchObject({
      kind: 'timeout',
      retryable: true,
    });

    expect(classify(new Error('Socket timeout (the database failed to respond to a query within the configured timeout)')))
      .toMatchObject({
        kind: 'timeout',
        retryable: true,
      });
  });

  it('recovers a network code carried only on the error cause (api.ts wrapper preservation)', async () => {
    const mod = await loadClassifierModule();
    const classify = mod.classifyDaemonServerWorkError!;

    const wrapped = new Error('Failed to get connected service auth group: connect ECONNREFUSED 127.0.0.1:52753', {
      cause: { code: 'ECONNREFUSED' },
    });

    expect(classify(wrapped)).toMatchObject({ kind: 'network', retryable: true });
  });

  it('treats a code-stripped network message as network/retryable via the message fallback', async () => {
    const mod = await loadClassifierModule();
    const classify = mod.classifyDaemonServerWorkError!;

    // A higher layer flattened the error to a plain message with no code/cause. A transient
    // local-endpoint outage must still be retryable, not a non-retryable protocol error.
    expect(classify(new Error('Failed to get connected service auth group: connect ECONNREFUSED 127.0.0.1:52753')))
      .toMatchObject({ kind: 'network', retryable: true });

    expect(classify(new Error('socket hang up'))).toMatchObject({ kind: 'network', retryable: true });
  });

  it('still classifies a non-network, code-less message as a non-retryable protocol error', async () => {
    const mod = await loadClassifierModule();
    const classify = mod.classifyDaemonServerWorkError!;

    expect(classify(new Error('Invalid connected service auth group response')))
      .toMatchObject({ kind: 'protocol_error', retryable: false });
  });

  it('backs off retryable dependency-unavailable work without treating it as a protocol error', async () => {
    const mod = await loadClassifierModule();

    expect(mod.classifyDaemonServerWorkError).toEqual(expect.any(Function));

    const classify = mod.classifyDaemonServerWorkError!;

    expect(classify({
      code: 'HAPPIER_ACCOUNT_MODE_UNKNOWN',
      retryAfterMs: 30_000,
      message: 'account mode temporarily unavailable',
    })).toMatchObject({
      kind: 'dependency_unavailable',
      retryable: true,
      retryAfterMs: 30_000,
    });
  });

  it('classifies configured 404 responses as unsupported feature absence', async () => {
    const mod = await loadClassifierModule();

    expect(mod.classifyDaemonServerWorkError).toEqual(expect.any(Function));

    const classify = mod.classifyDaemonServerWorkError!;

    expect(classify(createHttpStatusError(404, 'not found'), { featureAbsentStatusCodes: [404] })).toMatchObject({
      kind: 'unsupported',
      retryable: false,
      statusCode: 404,
    });

    expect(classify(createHttpStatusError(404, 'not found'))).toMatchObject({
      kind: 'client_error',
      retryable: false,
      statusCode: 404,
    });
  });
});
