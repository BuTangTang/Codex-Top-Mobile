import {
  HAPPIER_CONNECTED_SERVICE_MATERIALIZED_ENV_KEYS_ENV_KEY,
  HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY,
  findConnectedServiceChildSelection,
  readConnectedServiceMaterializedEnvKeysFromEnv,
} from '@/daemon/connectedServices/connectedServiceChildEnvironment';

import {
  CLAUDE_AUTH_ENV_KEYS,
  CLAUDE_RUNTIME_REFRESH_SECRET_ENV_KEYS,
  type ClaudeAuthEnvKey,
} from '../auth/claudeAuthEnvKeys';

function toMaterializedKeySet(env: Pick<NodeJS.ProcessEnv, string>): Set<string> {
  return new Set(readConnectedServiceMaterializedEnvKeysFromEnv(env));
}

function resolveAllowedConnectedAuthEnvKeys(
  env: Pick<NodeJS.ProcessEnv, string>,
): Set<ClaudeAuthEnvKey> | null {
  const selection =
    findConnectedServiceChildSelection(env, 'claude-subscription')
    ?? findConnectedServiceChildSelection(env, 'anthropic');
  if (!selection) return null;

  const serviceAllowedKeys: readonly ClaudeAuthEnvKey[] = selection.serviceId === 'anthropic'
    ? ['ANTHROPIC_API_KEY']
    : [];
  const materializedKeys = toMaterializedKeySet(env);
  if (materializedKeys.size === 0) return new Set(serviceAllowedKeys);

  return new Set(serviceAllowedKeys.filter((key) => materializedKeys.has(key)));
}

function stripInternalConnectedServiceEnv(env: NodeJS.ProcessEnv): void {
  delete env[HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY];
  delete env[HAPPIER_CONNECTED_SERVICE_MATERIALIZED_ENV_KEYS_ENV_KEY];
}

export function isolateClaudeRuntimeAuthEnv<T extends NodeJS.ProcessEnv>(env: T): T {
  const allowedConnectedAuthKeys = resolveAllowedConnectedAuthEnvKeys(env);
  if (allowedConnectedAuthKeys) {
    for (const key of CLAUDE_AUTH_ENV_KEYS) {
      if (!allowedConnectedAuthKeys.has(key)) {
        delete env[key];
      }
    }
    stripInternalConnectedServiceEnv(env);
    return env;
  }

  for (const key of CLAUDE_RUNTIME_REFRESH_SECRET_ENV_KEYS) {
    delete env[key];
  }
  stripInternalConnectedServiceEnv(env);
  return env;
}
