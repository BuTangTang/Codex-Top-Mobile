import { describe, expect, it } from 'vitest';

import { buildQuotaPersistenceKey, type QuotaPersistenceAccountScope } from './quotaPersistenceKey';

type QuotaPersistenceKeyModule = typeof import('./quotaPersistenceKey') & {
  resolveQuotaPersistenceAccountScope?: (credentials?: Readonly<{ token?: string | null }>) => QuotaPersistenceAccountScope;
};

async function loadQuotaPersistenceKeyModule(): Promise<QuotaPersistenceKeyModule> {
  return await import('./quotaPersistenceKey') as QuotaPersistenceKeyModule;
}

function createJwtWithSub(sub: string, marker: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', marker })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, marker })).toString('base64url');
  return `${header}.${payload}.sig-${marker}`;
}

describe('buildQuotaPersistenceKey', () => {
  it('returns the same key for the same server/account/service/profile scope', () => {
    const first = buildQuotaPersistenceKey({
      serverScope: 'server:prod',
      accountScope: { kind: 'known', value: 'acct_123' },
      serviceId: 'openai-codex',
      profileId: 'primary',
    });
    const second = buildQuotaPersistenceKey({
      serverScope: 'server:prod',
      accountScope: { kind: 'known', value: 'acct_123' },
      serviceId: 'openai-codex',
      profileId: 'primary',
    });

    expect(second.key).toBe(first.key);
  });

  it('separates server and account scopes', () => {
    const base = buildQuotaPersistenceKey({
      serverScope: 'server:prod',
      accountScope: { kind: 'known', value: 'acct_123' },
      serviceId: 'openai-codex',
      profileId: 'primary',
    });

    expect(buildQuotaPersistenceKey({
      serverScope: 'server:staging',
      accountScope: { kind: 'known', value: 'acct_123' },
      serviceId: 'openai-codex',
      profileId: 'primary',
    }).key).not.toBe(base.key);
    expect(buildQuotaPersistenceKey({
      serverScope: 'server:prod',
      accountScope: { kind: 'known', value: 'acct_456' },
      serviceId: 'openai-codex',
      profileId: 'primary',
    }).key).not.toBe(base.key);
  });

  it('does not expose raw tokens or account identifiers in key diagnostics', () => {
    const result = buildQuotaPersistenceKey({
      serverScope: 'https://server.example.test?token=raw-token',
      accountScope: { kind: 'known', value: 'acct_secret' },
      serviceId: 'openai-codex',
      profileId: 'primary',
    });
    const diagnosticText = JSON.stringify(result);

    expect(diagnosticText).not.toContain('raw-token');
    expect(diagnosticText).not.toContain('acct_secret');
    expect(diagnosticText).toContain('openai-codex');
    expect(diagnosticText).toContain('primary');
  });

  it('resolves quota account scope from JWT subject instead of refreshed token body', async () => {
    const mod = await loadQuotaPersistenceKeyModule();

    expect(mod.resolveQuotaPersistenceAccountScope).toEqual(expect.any(Function));

    const firstScope = mod.resolveQuotaPersistenceAccountScope!({
      token: createJwtWithSub('account-a@example.test', 'first-token'),
    });
    const refreshedScope = mod.resolveQuotaPersistenceAccountScope!({
      token: createJwtWithSub('account-a@example.test', 'refreshed-token'),
    });
    const differentAccountScope = mod.resolveQuotaPersistenceAccountScope!({
      token: createJwtWithSub('account-b@example.test', 'first-token'),
    });

    const first = buildQuotaPersistenceKey({
      serverScope: 'server:prod',
      accountScope: firstScope,
      serviceId: 'openai-codex',
      profileId: 'primary',
    });
    const refreshed = buildQuotaPersistenceKey({
      serverScope: 'server:prod',
      accountScope: refreshedScope,
      serviceId: 'openai-codex',
      profileId: 'primary',
    });
    const differentAccount = buildQuotaPersistenceKey({
      serverScope: 'server:prod',
      accountScope: differentAccountScope,
      serviceId: 'openai-codex',
      profileId: 'primary',
    });

    expect(refreshed.key).toBe(first.key);
    expect(differentAccount.key).not.toBe(first.key);
    expect(JSON.stringify(first)).not.toContain('account-a@example.test');
    expect(JSON.stringify(first)).not.toContain('first-token');
  });
});
