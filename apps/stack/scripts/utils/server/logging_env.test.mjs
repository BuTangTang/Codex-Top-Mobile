import assert from 'node:assert/strict';
import test from 'node:test';

import { applyStackServerLoggingDefaults } from './logging_env.mjs';

test('applyStackServerLoggingDefaults defaults stack-managed servers to warn logs', () => {
  const serverEnv = {};

  applyStackServerLoggingDefaults({ baseEnv: {}, serverEnv });

  assert.equal(serverEnv.HAPPIER_SERVER_LOG_LEVEL, 'warn');
});

test('applyStackServerLoggingDefaults honors explicit server logging env', () => {
  const serverEnv = {};

  applyStackServerLoggingDefaults({ baseEnv: { HAPPIER_SERVER_LOG_LEVEL: 'debug' }, serverEnv });

  assert.equal(serverEnv.HAPPIER_SERVER_LOG_LEVEL, 'debug');
});

test('applyStackServerLoggingDefaults supports a stack-specific override without mutating generic log level', () => {
  const serverEnv = { LOG_LEVEL: 'trace' };

  applyStackServerLoggingDefaults({ baseEnv: { HAPPIER_STACK_SERVER_LOG_LEVEL: 'error', LOG_LEVEL: 'trace' }, serverEnv });

  assert.equal(serverEnv.LOG_LEVEL, 'trace');
  assert.equal(serverEnv.HAPPIER_SERVER_LOG_LEVEL, 'error');
});
