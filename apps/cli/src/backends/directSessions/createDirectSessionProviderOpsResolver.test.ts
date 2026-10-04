import { describe, expect, it, vi } from 'vitest';
import type { DirectSessionsProviderId } from '@happier-dev/protocol';
import type { DirectSessionProviderOps } from './providerOps';

import { createDirectSessionProviderOpsResolver } from './createDirectSessionProviderOpsResolver';

describe('direct-session provider resolver', () => {
  it('shares a provider promise within one resolver without sharing across providers or resolver instances', async () => {
    const codexOps: DirectSessionProviderOps = { listCandidates: async () => ({ candidates: [], nextCursor: null }) };
    const claudeOps: DirectSessionProviderOps = { listCandidates: async () => ({ candidates: [], nextCursor: null }) };
    const loadCodex = vi.fn(async () => codexOps);
    const loadClaude = vi.fn(async () => claudeOps);
    const entries = { codex: { getDirectSessionProviderOps: loadCodex }, claude: { getDirectSessionProviderOps: loadClaude } };
    const lookup = (id: DirectSessionsProviderId) => entries[id as keyof typeof entries];
    const firstResolver = createDirectSessionProviderOpsResolver(lookup);
    const secondResolver = createDirectSessionProviderOpsResolver(lookup);

    const first = firstResolver('codex');
    expect(firstResolver('codex')).toBe(first);
    const separate = secondResolver('codex');
    expect(separate).not.toBe(first);
    const claude = firstResolver('claude');
    expect(claude).not.toBe(first);
    await expect(first).resolves.toBe(codexOps);
    await expect(separate).resolves.toBe(codexOps);
    await expect(claude).resolves.toBe(claudeOps);
    expect(loadCodex).toHaveBeenCalledTimes(2);
    expect(loadClaude).toHaveBeenCalledOnce();
    expect(firstResolver('codex')).toBe(first);
    expect(firstResolver('claude')).toBe(claude);
  });

  it('consults the current entry before every cache lookup and preserves synchronous missing-hook errors', async () => {
    const ops: DirectSessionProviderOps = { listCandidates: async () => ({ candidates: [], nextCursor: null }) };
    const load = vi.fn(async () => ops);
    let entry: { getDirectSessionProviderOps?: () => Promise<DirectSessionProviderOps> } | undefined = { getDirectSessionProviderOps: load };
    const lookup = vi.fn(() => entry);
    const resolve = createDirectSessionProviderOpsResolver(lookup);
    const cached = resolve('codex');
    await expect(cached).resolves.toBe(ops);
    entry = undefined;
    expect(() => resolve('codex')).toThrow('Missing direct-session provider ops for codex');
    entry = {};
    expect(() => resolve('codex')).toThrow('Missing direct-session provider ops for codex');
    entry = { getDirectSessionProviderOps: vi.fn(async () => ({ ...ops })) };
    expect(resolve('codex')).toBe(cached);
    expect(entry.getDirectSessionProviderOps).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(load).toHaveBeenCalledOnce();
  });
});
