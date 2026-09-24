import { describe, expect, it } from 'vitest';

import type { Metadata } from '@/api/types';
import type { TrackedSession } from '../types';
import { resolveTrackedSessionCatalogAgentId } from './resolveTrackedSessionCatalogAgentId';

function trackedSession(overrides: Partial<TrackedSession>): TrackedSession {
  return {
    startedBy: 'daemon',
    pid: 123,
    ...overrides,
  };
}

function metadata(overrides: Partial<Metadata>): Metadata {
  return {
    path: '/repo',
    host: 'test',
    homeDir: '/home/test',
    happyHomeDir: '/home/test/.happier',
    happyLibDir: '/home/test/.happier/lib',
    happyToolsDir: '/home/test/.happier/tools',
    ...overrides,
  };
}

describe('resolveTrackedSessionCatalogAgentId', () => {
  it('uses the explicit built-in backend target first', () => {
    expect(resolveTrackedSessionCatalogAgentId(trackedSession({
      happySessionMetadataFromLocalWebhook: metadata({
        codexSessionId: 'codex-session',
      }),
      spawnOptions: {
        directory: '/repo',
        backendTarget: { kind: 'builtInAgent', agentId: 'opencode' },
      } as TrackedSession['spawnOptions'],
    }))).toBe('opencode');
  });

  it('infers Codex from local webhook metadata when spawn options are not hydrated yet', () => {
    expect(resolveTrackedSessionCatalogAgentId(trackedSession({
      happySessionMetadataFromLocalWebhook: metadata({
        codexSessionId: 'codex-session',
        codexBackendMode: 'appServer',
      }),
    }))).toBe('codex');
  });

  it('keeps configured ACP backend targets on the custom ACP catalog entry', () => {
    expect(resolveTrackedSessionCatalogAgentId(trackedSession({
      happySessionMetadataFromLocalWebhook: metadata({
        codexSessionId: 'codex-session',
      }),
      spawnOptions: {
        directory: '/repo',
        backendTarget: { kind: 'configuredAcpBackend', backendId: 'review-bot' },
      } as TrackedSession['spawnOptions'],
    }))).toBe('customAcp');
  });
});
