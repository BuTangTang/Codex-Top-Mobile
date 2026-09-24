import { describe, expect, it } from 'vitest';

import { readOpenCodeUsageTelemetryFromMessageInfo } from './openCodeUsageTelemetry';

describe('readOpenCodeUsageTelemetryFromMessageInfo', () => {
  it('fails closed when assistant usage telemetry omits a valid size and no fallback is available', () => {
    expect(readOpenCodeUsageTelemetryFromMessageInfo({
      info: {
        role: 'assistant',
        used: 1200,
        contextWindowTokens: 'not-a-number',
      },
      fallbackContextWindowTokens: null,
    })).toBeNull();
  });

  it('derives usage totals from token breakdown fields and falls back to the caller context window', () => {
    expect(readOpenCodeUsageTelemetryFromMessageInfo({
      info: {
        role: 'assistant',
        providerID: 'opencode',
        modelID: 'gpt-5-nano',
        tokens: {
          input: 700,
          output: 250,
          reasoning: 50,
          cache: {
            read: 200,
          },
        },
      },
      fallbackContextWindowTokens: 128_000,
    })).toEqual({
      used: 1200,
      size: 128_000,
      model: 'opencode/gpt-5-nano',
    });
  });
});
