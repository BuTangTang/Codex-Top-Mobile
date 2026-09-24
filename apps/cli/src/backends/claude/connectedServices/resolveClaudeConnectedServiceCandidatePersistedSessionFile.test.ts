import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveConnectedServiceCandidatePersistedSessionFile } from '@/backends/catalog';

describe('resolveClaudeConnectedServiceCandidatePersistedSessionFile', () => {
  it('returns the persisted Claude transcript path when metadata proves the provider session file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-claude-candidate-'));
    const sessionId = 'f55b3644-befc-406a-90ac-b8fbcc33cbf6';
    const sessionPath = join(
      root,
      'claude-subscription',
      'leeroy_new',
      'claude',
      'claude-config',
      'projects',
      '-Users-leeroy-Documents-Development-happier-remote-dev',
      `${sessionId}.jsonl`,
    );
    await mkdir(dirname(sessionPath), { recursive: true });
    await writeFile(sessionPath, '{"type":"assistant"}\n');

    expect(resolveConnectedServiceCandidatePersistedSessionFile('claude', {
      claudeSessionId: sessionId,
      claudeTranscriptPath: sessionPath,
    })).toBe(sessionPath);
  });

  it('rejects stale or unsafe Claude transcript metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-claude-candidate-'));
    const sessionId = 'f55b3644-befc-406a-90ac-b8fbcc33cbf6';
    const otherPath = join(root, 'projects', 'worktree', 'other-session.jsonl');
    await mkdir(dirname(otherPath), { recursive: true });
    await writeFile(otherPath, '{"type":"assistant"}\n');

    expect(resolveConnectedServiceCandidatePersistedSessionFile('claude', {
      claudeSessionId: sessionId,
      claudeTranscriptPath: otherPath,
    })).toBeNull();
    expect(resolveConnectedServiceCandidatePersistedSessionFile('claude', {
      claudeSessionId: sessionId,
      claudeTranscriptPath: 'relative/projects/worktree/f55b3644-befc-406a-90ac-b8fbcc33cbf6.jsonl',
    })).toBeNull();
    expect(resolveConnectedServiceCandidatePersistedSessionFile('claude', {
      claudeSessionId: '../escape',
      claudeTranscriptPath: join(root, 'projects', 'worktree', '../escape.jsonl'),
    })).toBeNull();
  });
});
