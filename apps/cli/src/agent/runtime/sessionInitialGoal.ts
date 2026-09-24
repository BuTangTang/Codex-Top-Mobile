import {
  SessionInitialGoalRequestV1Schema,
  type SessionInitialGoalRequestV1,
} from '@happier-dev/protocol';

export const HAPPIER_DAEMON_INITIAL_GOAL_ENV_KEY = 'HAPPIER_DAEMON_INITIAL_GOAL_V1_JSON';

export function serializeDaemonInitialGoalForEnv(goal: SessionInitialGoalRequestV1): string {
  return JSON.stringify(SessionInitialGoalRequestV1Schema.parse(goal));
}

export function readDaemonInitialGoalFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SessionInitialGoalRequestV1 | null {
  const raw = typeof env[HAPPIER_DAEMON_INITIAL_GOAL_ENV_KEY] === 'string'
    ? env[HAPPIER_DAEMON_INITIAL_GOAL_ENV_KEY]
    : '';
  delete env[HAPPIER_DAEMON_INITIAL_GOAL_ENV_KEY];
  if (!raw.trim()) return null;

  try {
    return SessionInitialGoalRequestV1Schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
