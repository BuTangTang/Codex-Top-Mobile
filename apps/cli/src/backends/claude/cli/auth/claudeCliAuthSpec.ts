import { basename, join } from 'node:path';

import { getAgentAuthProbeConfig } from '@happier-dev/agents';
import { createCatalogCliAuthSpec } from '@/capabilities/cliAuth/createCatalogCliAuthSpec';
import { readJsonFileSafe, readStringField } from '@/capabilities/cliAuth/shared';
import { parseClaudeCodeCredentialFile } from '@/backends/claude/connectedServices/nativeAuth/claudeCodeCredentialFile';
import type { CliAuthSpec, CliAuthStatusDraft } from '@/backends/types';
import { resolveConfiguredClaudeConfigDir } from '@/backends/claude/utils/resolveConfiguredClaudeConfigDir';

function readClaudeOauthAccountLabel(record: Record<string, unknown>): string | null {
  const oauthAccount =
    record.oauthAccount && typeof record.oauthAccount === 'object' && !Array.isArray(record.oauthAccount)
      ? record.oauthAccount as Record<string, unknown>
      : null;

  return oauthAccount
    ? readStringField(oauthAccount, 'emailAddress')
      ?? readStringField(oauthAccount, 'email')
      ?? readStringField(oauthAccount, 'displayName')
      ?? readStringField(oauthAccount, 'name')
    : null;
}

function readClaudeAccountLabel(configDir: string, fallbackRecord?: Record<string, unknown>): string | undefined {
  const rootConfig = readJsonFileSafe(join(configDir, '.claude.json'));
  const rootRecord =
    rootConfig && typeof rootConfig === 'object' && !Array.isArray(rootConfig)
      ? rootConfig as Record<string, unknown>
      : null;
  const accountLabel =
    (rootRecord ? readClaudeOauthAccountLabel(rootRecord) : null)
    ?? (fallbackRecord ? readClaudeOauthAccountLabel(fallbackRecord) : null)
    ?? (fallbackRecord ? readStringField(fallbackRecord, 'email') : null)
    ?? (fallbackRecord ? readStringField(fallbackRecord, 'accountEmail') : null)
    ?? (fallbackRecord ? readStringField(fallbackRecord, 'userEmail') : null);

  return accountLabel ?? undefined;
}

function readClaudeCredentialsStatus(env: NodeJS.ProcessEnv): CliAuthStatusDraft {
  const configDir = resolveConfiguredClaudeConfigDir({ env });
  const credentialFiles = Array.from(new Set([
    ...(getAgentAuthProbeConfig('claude').credentialPaths?.map((credentialPath) => basename(credentialPath)) ?? []),
    '.credentials.json',
    'credentials.json',
  ]));
  let expiredCredentialsStatus: CliAuthStatusDraft | null = null;

  for (const credentialFile of credentialFiles) {
    const parsed = readJsonFileSafe(join(configDir, credentialFile));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const credential = parseClaudeCodeCredentialFile(record);
    if (credential.status !== 'ok' || !credential.hasAccessToken) {
      continue;
    }

    if (credential.expiresAt !== null && credential.expiresAt <= Date.now()) {
      expiredCredentialsStatus = { state: 'logged_out', reason: 'expired', source: 'file', method: 'credentials_file' };
      continue;
    }

    return {
      state: 'logged_in',
      method: 'credentials_file',
      source: 'file',
      ...(() => {
        const accountLabel = readClaudeAccountLabel(configDir, record);
        return accountLabel ? { accountLabel } : {};
      })(),
    };
  }

  if (expiredCredentialsStatus) {
    return expiredCredentialsStatus;
  }

  return { state: 'logged_out', reason: 'missing_credentials' };
}

export const claudeCliAuthSpec: CliAuthSpec = createCatalogCliAuthSpec('claude', {
  detectAuthStatus: async () => {
    const anthropicApiKey = typeof process.env.ANTHROPIC_API_KEY === 'string' ? process.env.ANTHROPIC_API_KEY.trim() : '';
    if (anthropicApiKey) {
      return {
        state: 'logged_in',
        method: 'api_key_env',
        source: 'env',
        reason: null,
      };
    }

    const anthropicAuthToken = typeof process.env.ANTHROPIC_AUTH_TOKEN === 'string' ? process.env.ANTHROPIC_AUTH_TOKEN.trim() : '';
    if (anthropicAuthToken) {
      return {
        state: 'logged_in',
        method: 'auth_token_env',
        source: 'env',
        reason: null,
      };
    }

    return readClaudeCredentialsStatus(process.env);
  },
});
