import {
    HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY,
} from '@/daemon/connectedServices/connectedServiceChildEnvironment';
import { CLAUDE_AUTH_ENV_KEYS, CLAUDE_CONFIG_ENV_KEYS } from '../auth/claudeAuthEnvKeys';

const CLAUDE_RUNTIME_AUTH_ENV_KEYS = [
    ...CLAUDE_AUTH_ENV_KEYS,
    ...CLAUDE_CONFIG_ENV_KEYS,
] as const;

export type ClaudeRuntimeAuthEnvDiagnostic = Readonly<{
    presentAuthEnvKeys: string[];
    hasAnthropicApiKey: boolean;
    hasAnthropicAuthToken: boolean;
    hasAnthropicOauthToken: boolean;
    hasClaudeCodeOauthToken: boolean;
    hasClaudeCodeSetupToken: boolean;
    hasClaudeCodeOauthRefreshToken: boolean;
    hasClaudeCodeOauthScopes: boolean;
    hasClaudeConfigDir: boolean;
    hasHappierConnectedServiceSelections: boolean;
}>;

function hasNonBlankEnvValue(env: Pick<NodeJS.ProcessEnv, string>, key: string): boolean {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
}

export function resolveClaudeRuntimeAuthEnvDiagnostic(
    env: Pick<NodeJS.ProcessEnv, string>,
): ClaudeRuntimeAuthEnvDiagnostic {
    const presentAuthEnvKeys = CLAUDE_RUNTIME_AUTH_ENV_KEYS
        .filter((key) => hasNonBlankEnvValue(env, key));

    return {
        presentAuthEnvKeys,
        hasAnthropicApiKey: hasNonBlankEnvValue(env, 'ANTHROPIC_API_KEY'),
        hasAnthropicAuthToken: hasNonBlankEnvValue(env, 'ANTHROPIC_AUTH_TOKEN'),
        hasAnthropicOauthToken: hasNonBlankEnvValue(env, 'ANTHROPIC_OAUTH_TOKEN'),
        hasClaudeCodeOauthToken: hasNonBlankEnvValue(env, 'CLAUDE_CODE_OAUTH_TOKEN'),
        hasClaudeCodeSetupToken: hasNonBlankEnvValue(env, 'CLAUDE_CODE_SETUP_TOKEN'),
        hasClaudeCodeOauthRefreshToken: hasNonBlankEnvValue(env, 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN'),
        hasClaudeCodeOauthScopes: hasNonBlankEnvValue(env, 'CLAUDE_CODE_OAUTH_SCOPES'),
        hasClaudeConfigDir: hasNonBlankEnvValue(env, 'CLAUDE_CONFIG_DIR'),
        hasHappierConnectedServiceSelections: hasNonBlankEnvValue(env, HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY),
    };
}
