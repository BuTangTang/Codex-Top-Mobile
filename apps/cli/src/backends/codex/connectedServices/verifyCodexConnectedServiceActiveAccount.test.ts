import { describe, expect, it, vi } from 'vitest';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { verifyCodexConnectedServiceActiveAccount } from './verifyCodexConnectedServiceActiveAccount';

function record(providerAccountId: string) {
  return buildConnectedServiceCredentialRecord({
    now: 1_000,
    serviceId: 'openai-codex',
    profileId: 'codex1',
    kind: 'oauth',
    expiresAt: 2_000,
    oauth: {
      accessToken: 'access',
      refreshToken: 'refresh',
      idToken: 'id',
      scope: null,
      tokenType: null,
      providerAccountId,
      providerEmail: null,
    },
  });
}

function recordWithEmail(input: Readonly<{ providerAccountId: string; providerEmail: string }>) {
  return buildConnectedServiceCredentialRecord({
    now: 1_000,
    serviceId: 'openai-codex',
    profileId: 'codex1',
    kind: 'oauth',
    expiresAt: 2_000,
    oauth: {
      accessToken: 'access',
      refreshToken: 'refresh',
      idToken: 'id',
      scope: null,
      tokenType: null,
      providerAccountId: input.providerAccountId,
      providerEmail: input.providerEmail,
    },
  });
}

describe('verifyCodexConnectedServiceActiveAccount', () => {
  it('verifies the expected Codex account id from the active app-server account probe', async () => {
    const client = {
      request: vi.fn(async () => ({ account: { id: 'acct_codex1' } })),
    };

    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: record('acct_codex1'),
        client,
      },
    })).resolves.toEqual({
      status: 'verified',
      providerAccountId: 'acct_codex1',
    });
    expect(client.request).toHaveBeenCalledWith('account/read', {});
  });

  it('verifies the expected Codex account id from root chatgpt_account_id proof', async () => {
    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: record('acct_codex1'),
        client: {
          request: vi.fn(async () => ({ chatgpt_account_id: 'acct_codex1' })),
        },
      },
    })).resolves.toEqual({
      status: 'verified',
      providerAccountId: 'acct_codex1',
    });
  });

  it('verifies top-level Codex account id proof when account details are nested separately', async () => {
    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: record('acct_codex1'),
        client: {
          request: vi.fn(async () => ({
            account: { email: 'codex1@example.test', planType: 'plus' },
            chatgpt_account_id: 'acct_codex1',
          })),
        },
      },
    })).resolves.toEqual({
      status: 'verified',
      providerAccountId: 'acct_codex1',
    });
  });

  it('verifies the expected Codex account id from nested account chatgpt_account_id proof', async () => {
    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: record('acct_codex1'),
        client: {
          request: vi.fn(async () => ({ account: { chatgpt_account_id: 'acct_codex1' } })),
        },
      },
    })).resolves.toEqual({
      status: 'verified',
      providerAccountId: 'acct_codex1',
    });
  });

  it('returns a structured retryable mismatch when Codex still reports the previous account', async () => {
    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: record('acct_codex1'),
        client: {
          request: vi.fn(async () => ({ chatgptAccountId: 'acct_leeroy' })),
        },
      },
    })).resolves.toEqual({
      status: 'mismatch',
      expectedProviderAccountId: 'acct_codex1',
      actualProviderAccountId: 'acct_leeroy',
      retryable: true,
      reason: 'provider_account_adoption_mismatch',
    });
  });

  it('does not accept Codex account adoption from email-only account/read when no live account-id proof is available', async () => {
    const client = {
      request: vi.fn(async () => ({ account: { email: '  Codex1@Example.Test  ', planType: 'plus' } })),
    };

    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: recordWithEmail({
          providerAccountId: 'acct_codex1',
          providerEmail: 'codex1@example.test',
        }),
        client,
      },
    })).resolves.toEqual({
      status: 'unavailable',
      retryable: true,
      reason: 'active_account_probe_missing_account_id',
    });
  });

  it('treats email-only account/read mismatch as diagnostic-only when no live account-id proof is available', async () => {
    const client = {
      request: vi.fn(async () => ({ account: { email: 'other@example.test', planType: 'plus' } })),
    };

    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: recordWithEmail({
          providerAccountId: 'acct_codex1',
          providerEmail: 'codex1@example.test',
        }),
        client,
      },
    })).resolves.toEqual({
      status: 'unavailable',
      retryable: true,
      reason: 'active_account_probe_missing_account_id',
    });
  });

  it('does not accept Codex account adoption from auth-store proof when live account/read omits account id', async () => {
    const client = {
      request: vi.fn(async () => ({
        account: { type: 'chatgpt', email: '  Codex1@Example.Test  ', planType: 'pro' },
        requiresOpenaiAuth: true,
      })),
    };

    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: recordWithEmail({
          providerAccountId: 'acct_codex1',
          providerEmail: 'codex1@example.test',
        }),
        client,
        readAuthStoreProviderAccountId: vi.fn(async () => 'acct_codex1'),
      },
    })).resolves.toEqual({
      status: 'unavailable',
      retryable: true,
      reason: 'active_account_probe_missing_account_id',
    });
  });

  it('does not let email-only account/read mismatch override matching auth-store diagnostics', async () => {
    const client = {
      request: vi.fn(async () => ({
        account: { type: 'chatgpt', email: 'other@example.test', planType: 'pro' },
        requiresOpenaiAuth: true,
      })),
    };

    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: recordWithEmail({
          providerAccountId: 'acct_codex1',
          providerEmail: 'codex1@example.test',
        }),
        client,
        readAuthStoreProviderAccountId: vi.fn(async () => 'acct_codex1'),
      },
    })).resolves.toEqual({
      status: 'unavailable',
      retryable: true,
      reason: 'active_account_probe_missing_account_id',
    });
  });

  it('treats missing live email and account id as missing proof, not an email mismatch', async () => {
    const client = {
      request: vi.fn(async () => ({
        account: { type: 'chatgpt', planType: 'pro' },
        requiresOpenaiAuth: true,
      })),
    };

    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: recordWithEmail({
          providerAccountId: 'acct_codex1',
          providerEmail: 'codex1@example.test',
        }),
        client,
        readAuthStoreProviderAccountId: vi.fn(async () => 'acct_codex1'),
      },
    })).resolves.toEqual({
      status: 'unavailable',
      retryable: true,
      reason: 'active_account_probe_missing_account_id',
    });
  });

  it('returns a retryable mismatch when Codex account/read is email-only but the materialized auth store still has another account id', async () => {
    const client = {
      request: vi.fn(async () => ({
        account: { type: 'chatgpt', email: 'codex1@example.test', planType: 'pro' },
        requiresOpenaiAuth: true,
      })),
    };

    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: recordWithEmail({
          providerAccountId: 'acct_codex1',
          providerEmail: 'codex1@example.test',
        }),
        client,
        readAuthStoreProviderAccountId: vi.fn(async () => 'acct_leeroy'),
      },
    })).resolves.toEqual({
      status: 'mismatch',
      expectedProviderAccountId: 'acct_codex1',
      actualProviderAccountId: 'acct_leeroy',
      retryable: true,
      reason: 'provider_account_auth_store_mismatch',
    });
  });

  it('returns a retryable mismatch when email-only account/read is paired with conflicting auth-store account ids', async () => {
    const client = {
      request: vi.fn(async () => ({
        account: { type: 'chatgpt', email: 'codex1@example.test', planType: 'pro' },
        requiresOpenaiAuth: true,
      })),
    };

    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: recordWithEmail({
          providerAccountId: 'acct_codex1',
          providerEmail: 'codex1@example.test',
        }),
        client,
        readAuthStoreProviderAccountId: vi.fn(async () => ({
          status: 'conflict',
          accountIds: ['acct_codex1', 'acct_leeroy'],
        })),
      },
    })).resolves.toEqual({
      status: 'mismatch',
      expectedProviderAccountId: 'acct_codex1',
      actualProviderAccountId: 'acct_leeroy',
      retryable: true,
      reason: 'provider_account_auth_store_conflict',
    });
  });

  it('returns a structured retryable unavailable result when the active-account probe times out', async () => {
    await expect(verifyCodexConnectedServiceActiveAccount({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'codex1',
        record: record('acct_codex1'),
        client: {
          request: vi.fn(async () => {
            throw new Error('timeout of 5000ms exceeded');
          }),
        },
      },
    })).resolves.toMatchObject({
      status: 'unavailable',
      retryable: true,
      reason: 'active_account_probe_failed',
    });
  });
});
