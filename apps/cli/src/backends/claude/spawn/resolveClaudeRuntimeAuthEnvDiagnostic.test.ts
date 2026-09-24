import { describe, expect, it } from 'vitest';

import {
    HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY,
} from '@/daemon/connectedServices/connectedServiceChildEnvironment';

import { resolveClaudeRuntimeAuthEnvDiagnostic } from './resolveClaudeRuntimeAuthEnvDiagnostic';

describe('resolveClaudeRuntimeAuthEnvDiagnostic', () => {
    it('reports Claude runtime auth key presence without exposing values', () => {
        const diagnostic = resolveClaudeRuntimeAuthEnvDiagnostic({
            ANTHROPIC_API_KEY: 'sk-ant-secret',
            ANTHROPIC_AUTH_TOKEN: 'auth-secret',
            ANTHROPIC_OAUTH_TOKEN: 'oauth-secret',
            CLAUDE_CODE_OAUTH_TOKEN: 'claude-oauth-secret',
            CLAUDE_CODE_SETUP_TOKEN: 'claude-setup-secret',
            CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'refresh-secret',
            CLAUDE_CODE_OAUTH_SCOPES: 'user:inference',
            CLAUDE_CONFIG_DIR: '/Users/test/.claude',
            [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: '[{"kind":"profile"}]',
        });

        expect(diagnostic).toEqual({
            presentAuthEnvKeys: [
                'ANTHROPIC_API_KEY',
                'ANTHROPIC_AUTH_TOKEN',
                'ANTHROPIC_OAUTH_TOKEN',
                'CLAUDE_CODE_OAUTH_TOKEN',
                'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
                'CLAUDE_CODE_OAUTH_SCOPES',
                'CLAUDE_CODE_SETUP_TOKEN',
                'CLAUDE_CONFIG_DIR',
            ],
            hasAnthropicApiKey: true,
            hasAnthropicAuthToken: true,
            hasAnthropicOauthToken: true,
            hasClaudeCodeOauthToken: true,
            hasClaudeCodeSetupToken: true,
            hasClaudeCodeOauthRefreshToken: true,
            hasClaudeCodeOauthScopes: true,
            hasClaudeConfigDir: true,
            hasHappierConnectedServiceSelections: true,
        });

        expect(JSON.stringify(diagnostic)).not.toContain('secret');
        expect(JSON.stringify(diagnostic)).not.toContain('/Users/test/.claude');
    });

    it('ignores blank runtime auth values', () => {
        const diagnostic = resolveClaudeRuntimeAuthEnvDiagnostic({
            ANTHROPIC_API_KEY: '   ',
            CLAUDE_CODE_OAUTH_TOKEN: '',
        });

        expect(diagnostic.presentAuthEnvKeys).toEqual([]);
        expect(diagnostic.hasAnthropicApiKey).toBe(false);
        expect(diagnostic.hasClaudeCodeOauthToken).toBe(false);
        expect(diagnostic.hasHappierConnectedServiceSelections).toBe(false);
    });
});
