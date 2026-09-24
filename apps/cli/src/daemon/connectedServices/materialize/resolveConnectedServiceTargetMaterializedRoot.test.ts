import { describe, expect, it } from 'vitest';

import { HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY } from '../connectedServiceChildEnvironment';
import { resolveConnectedServiceTargetMaterializedRoot } from './resolveConnectedServiceTargetMaterializedRoot';

describe('resolveConnectedServiceTargetMaterializedRoot', () => {
  it('resolves PI materialized root from PI_CODING_AGENT_DIR', () => {
    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'pi',
      targetMaterializedEnv: {
        PI_CODING_AGENT_DIR: '/tmp/materialized/pi-agent-dir',
      },
    })).toBe('/tmp/materialized');
  });

  it('falls back to legacy PI_CODING_AGENT_SESSION_DIR for PI', () => {
    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'pi',
      targetMaterializedEnv: {
        PI_CODING_AGENT_SESSION_DIR: '/tmp/materialized/pi-sessions',
      },
    })).toBe('/tmp/materialized');
  });

  it('resolves Codex materialized root from CODEX_HOME or CODEX_SQLITE_HOME', () => {
    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'codex',
      targetMaterializedEnv: {
        CODEX_HOME: '/tmp/materialized/codex-home',
      },
    })).toBe('/tmp/materialized');

    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'codex',
      targetMaterializedEnv: {
        CODEX_SQLITE_HOME: '/tmp/materialized/codex-home',
      },
    })).toBe('/tmp/materialized');
  });

  it('resolves Gemini materialized root from GEMINI_CLI_HOME', () => {
    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'gemini',
      targetMaterializedEnv: {
        GEMINI_CLI_HOME: '/tmp/materialized/home',
      },
    })).toBe('/tmp/materialized');
  });

  it('resolves Claude materialized root from CLAUDE_CONFIG_DIR', () => {
    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'claude',
      targetMaterializedEnv: {
        CLAUDE_CONFIG_DIR: '/tmp/materialized/claude-config',
      },
    })).toBe('/tmp/materialized');
  });

  it('returns the explicit materialized root from the shared target-root env key', () => {
    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'opencode',
      targetMaterializedEnv: {
        [HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]: '/tmp/materialized/opencode',
      },
    })).toBe('/tmp/materialized/opencode');
  });

  it('returns null when the materialized env does not expose a root', () => {
    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'pi',
      targetMaterializedEnv: null,
    })).toBeNull();
  });
});
