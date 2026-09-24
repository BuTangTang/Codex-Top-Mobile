import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';
import {
  readCodexAuthStoreProviderAccountId,
  readCodexAuthStoreProviderAccountIdFromJson,
} from './readCodexAuthStoreProviderAccountId';

function buildJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'sig',
  ].join('.');
}

describe('readCodexAuthStoreProviderAccountId', () => {
  it('reads the connected-service flat Codex auth account id', () => {
    expect(readCodexAuthStoreProviderAccountIdFromJson({
      auth_mode: 'chatgpt',
      account_id: 'acct_flat',
      tokens: {
        account_id: 'acct_flat',
      },
    })).toEqual({ status: 'resolved', accountId: 'acct_flat' });
  });

  it('returns a conflict when auth-store account-id aliases disagree', () => {
    expect(readCodexAuthStoreProviderAccountIdFromJson({
      auth_mode: 'chatgpt',
      account_id: 'acct_flat',
      tokens: {
        account_id: 'acct_tokens',
      },
    })).toEqual({
      status: 'conflict',
      accountIds: ['acct_flat', 'acct_tokens'],
    });
  });

  it('reads the upstream Codex token account id', async () => {
    await withTempDir('happier-codex-auth-store-', async (root) => {
      const codexHome = join(root, 'codex-home');
      await mkdir(codexHome, { recursive: true });
      await writeFile(join(codexHome, 'auth.json'), JSON.stringify({
        auth_mode: 'chatgptAuthTokens',
        tokens: {
          access_token: 'redacted',
          refresh_token: 'redacted',
          account_id: 'acct_tokens',
        },
      }));

      await expect(readCodexAuthStoreProviderAccountId(codexHome)).resolves.toEqual({
        status: 'resolved',
        accountId: 'acct_tokens',
      });
    });
  });

  it('reads the upstream Codex token account id and email from an id_token JWT', async () => {
    await withTempDir('happier-codex-auth-store-', async (root) => {
      const codexHome = join(root, 'codex-home');
      await mkdir(codexHome, { recursive: true });
      await writeFile(join(codexHome, 'auth.json'), JSON.stringify({
        auth_mode: 'chatgptAuthTokens',
        tokens: {
          access_token: 'redacted',
          refresh_token: 'redacted',
          id_token: buildJwt({
            chatgpt_account_id: 'acct_from_jwt',
            email: 'codex-user@example.test',
          }),
        },
      }));

      await expect(readCodexAuthStoreProviderAccountId(codexHome)).resolves.toEqual({
        status: 'resolved',
        accountId: 'acct_from_jwt',
        accountEmail: 'codex-user@example.test',
      });
    });
  });
});
