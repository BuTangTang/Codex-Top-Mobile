import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';

import { createSessionMediaAccessPolicy } from './createSessionMediaAccessPolicy';

describe('createSessionMediaAccessPolicy', () => {
  it('restricts session media local-file ingestion to the workspace and explicit provider roots', () => {
    const policy = createSessionMediaAccessPolicy({
      workingDirectory: '/workspace/project',
      providerMediaRoots: ['/Users/tester/.codex', '/Users/tester/.codex', ''],
    });

    expect(policy).toEqual({
      kind: 'restrictedRoots',
      roots: ['/workspace/project', '/Users/tester/.codex'],
    });
  });

  it('normalizes workspace and provider roots before deduping them', () => {
    const workspace = join('/tmp', 'project', '..', 'project');
    const policy = createSessionMediaAccessPolicy({
      workingDirectory: workspace,
      providerMediaRoots: [join('/tmp', 'project')],
    });

    expect(policy.roots).toEqual([join('/tmp', 'project')]);
  });

  it('accepts custom and connected-service Codex homes through the resolved provider root', () => {
    const workspace = '/workspace/project';
    const customEnv = {
      HOME: '/Users/tester',
      CODEX_HOME: '~/custom-codex-home',
    } satisfies NodeJS.ProcessEnv;
    const connectedCodexHome = join(
      '/Users/tester/.happier/servers/cloud',
      'daemon',
      'connected-services',
      'homes',
      'openai-codex',
      'work',
      'codex',
      'codex-home',
    );

    const policy = createSessionMediaAccessPolicy({
      workingDirectory: workspace,
      providerMediaRoots: [
        resolveConfiguredCodexHome(customEnv),
        resolveConfiguredCodexHome({ CODEX_HOME: connectedCodexHome }),
      ],
    });

    expect(policy.roots).toEqual([
      workspace,
      '/Users/tester/custom-codex-home',
      connectedCodexHome,
    ]);
  });
});
