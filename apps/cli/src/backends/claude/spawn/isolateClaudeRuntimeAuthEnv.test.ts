import { describe, expect, it } from 'vitest';

import {
  HAPPIER_CONNECTED_SERVICE_MATERIALIZED_ENV_KEYS_ENV_KEY,
  HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY,
} from '@/daemon/connectedServices/connectedServiceChildEnvironment';
import { isolateClaudeRuntimeAuthEnv } from './isolateClaudeRuntimeAuthEnv';

describe('isolateClaudeRuntimeAuthEnv', () => {
  it('lets a connected Claude subscription native config override ambient provider auth', () => {
    const env = isolateClaudeRuntimeAuthEnv({
      ANTHROPIC_API_KEY: 'ambient-api-key',
      ANTHROPIC_AUTH_TOKEN: 'ambient-auth-token',
      CLAUDE_CODE_OAUTH_TOKEN: 'ambient-oauth-token',
      CLAUDE_CODE_SETUP_TOKEN: 'ambient-setup-token',
      CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'refresh-token',
      CLAUDE_CODE_OAUTH_SCOPES: 'scopes',
      CLAUDE_CONFIG_DIR: '/tmp/connected-claude',
      [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([
        { kind: 'profile', serviceId: 'claude-subscription', profileId: 'work' },
      ]),
      [HAPPIER_CONNECTED_SERVICE_MATERIALIZED_ENV_KEYS_ENV_KEY]: JSON.stringify([
        'CLAUDE_CONFIG_DIR',
      ]),
    });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/connected-claude');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_SETUP_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_SCOPES).toBeUndefined();
    expect(env[HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]).toBeUndefined();
    expect(env[HAPPIER_CONNECTED_SERVICE_MATERIALIZED_ENV_KEYS_ENV_KEY]).toBeUndefined();
  });

  it('preserves the connected Anthropic API key but strips stale Claude subscription auth', () => {
    const env = isolateClaudeRuntimeAuthEnv({
      ANTHROPIC_API_KEY: 'selected-api-key',
      CLAUDE_CODE_OAUTH_TOKEN: 'ambient-oauth-token',
      CLAUDE_CODE_SETUP_TOKEN: 'ambient-setup-token',
      [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([
        { kind: 'profile', serviceId: 'anthropic', profileId: 'api-profile' },
      ]),
      [HAPPIER_CONNECTED_SERVICE_MATERIALIZED_ENV_KEYS_ENV_KEY]: JSON.stringify([
        'ANTHROPIC_API_KEY',
      ]),
    });

    expect(env.ANTHROPIC_API_KEY).toBe('selected-api-key');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_SETUP_TOKEN).toBeUndefined();
  });

  it('keeps native Claude auth behavior except refresh-only runtime secrets', () => {
    const env = isolateClaudeRuntimeAuthEnv({
      ANTHROPIC_API_KEY: 'native-api-key',
      CLAUDE_CODE_OAUTH_TOKEN: 'native-oauth-token',
      CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'refresh-token',
      CLAUDE_CODE_OAUTH_SCOPES: 'scopes',
      CLAUDE_CONFIG_DIR: '/tmp/native-claude',
    });

    expect(env.ANTHROPIC_API_KEY).toBe('native-api-key');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('native-oauth-token');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/native-claude');
    expect(env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_SCOPES).toBeUndefined();
  });
});
