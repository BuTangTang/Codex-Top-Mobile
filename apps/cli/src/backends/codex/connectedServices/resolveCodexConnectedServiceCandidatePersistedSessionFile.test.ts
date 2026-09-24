import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveCodexConnectedServiceCandidatePersistedSessionFile } from './resolveCodexConnectedServiceCandidatePersistedSessionFile';

describe('resolveCodexConnectedServiceCandidatePersistedSessionFile', () => {
  it('resolves an app-server Codex rollout from metadata codexSessionId in the native sessions store', async () => {
    const home = await mkdtemp(join(tmpdir(), 'happier-codex-candidate-home-'));
    try {
      const sessionsRoot = join(home, '.codex', 'sessions');
      const rolloutPath = join(
        sessionsRoot,
        '2026',
        '05',
        '31',
        'rollout-2026-05-31T09-35-00-019e7cfd-2e3d-74f0-be76-b7459424f0a8.jsonl',
      );
      await mkdir(join(sessionsRoot, '2026', '05', '31'), { recursive: true });
      await writeFile(rolloutPath, '{}\n');

      expect(resolveCodexConnectedServiceCandidatePersistedSessionFile({
        metadata: {
          codexBackendMode: 'appServer',
          codexSessionId: '019e7cfd-2e3d-74f0-be76-b7459424f0a8',
        },
        env: { HOME: home },
      })).toBe(rolloutPath);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('does not treat non-app-server Codex metadata as an app-server rollout candidate', async () => {
    expect(resolveCodexConnectedServiceCandidatePersistedSessionFile({
      metadata: {
        codexBackendMode: 'mcp',
        codexSessionId: '019e7cfd-2e3d-74f0-be76-b7459424f0a8',
      },
      env: {},
    })).toBeNull();
  });

  it('returns null when app-server metadata has no matching native rollout file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'happier-codex-candidate-missing-home-'));
    try {
      expect(resolveCodexConnectedServiceCandidatePersistedSessionFile({
        metadata: {
          codexBackendMode: 'appServer',
          codexSessionId: '019e7cfd-2e3d-74f0-be76-b7459424f0a8',
        },
        env: { HOME: home },
      })).toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
