export function applyStackServerLoggingDefaults({ baseEnv = {}, serverEnv = {} } = {}) {
  const stackLevel = String(baseEnv.HAPPIER_STACK_SERVER_LOG_LEVEL ?? '').trim();
  if (stackLevel) {
    serverEnv.HAPPIER_SERVER_LOG_LEVEL = stackLevel;
    return serverEnv;
  }

  const explicitServerLevel = String(baseEnv.HAPPIER_SERVER_LOG_LEVEL ?? '').trim();
  if (explicitServerLevel) {
    serverEnv.HAPPIER_SERVER_LOG_LEVEL = explicitServerLevel;
    return serverEnv;
  }

  const inheritedLevel = String(baseEnv.HAPPIER_LOG_LEVEL ?? baseEnv.LOG_LEVEL ?? '').trim();
  if (!inheritedLevel && !String(serverEnv.HAPPIER_SERVER_LOG_LEVEL ?? '').trim()) {
    serverEnv.HAPPIER_SERVER_LOG_LEVEL = 'warn';
  }

  return serverEnv;
}
