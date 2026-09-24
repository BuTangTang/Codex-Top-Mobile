import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import type { SessionHandoffWorkspaceTransfer } from '@happier-dev/protocol';

import { prepareSessionHandoffSourceWorkspaceTransfer } from './sessionHandoffWorkspaceReplicationAdapter';

const execFile = promisify(execFileCallback);

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  await execFile('git', [...args], { cwd });
}

describe('prepareSessionHandoffSourceWorkspaceTransfer (handoffMetadataV2)', () => {
  it('includes sourceRootPath + manifest transfer publication when workspace transfer is enabled (server_routed_stream)', async () => {
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-handoff-source-transfer-'));
    const sourceRootPath = await mkdtemp(join(tmpdir(), 'happier-handoff-source-root-'));
    try {
      await mkdir(join(sourceRootPath, 'nested'), { recursive: true });
      await writeFile(join(sourceRootPath, 'README.md'), 'hello\n');
      await writeFile(join(sourceRootPath, 'nested', 'note.txt'), 'note\n');

      const workspaceTransfer: SessionHandoffWorkspaceTransfer = {
        enabled: true,
        strategy: 'transfer_snapshot',
        conflictPolicy: 'replace_existing',
        includeIgnoredMode: 'exclude',
        ignoredIncludeGlobs: [],
      };

      const result = await prepareSessionHandoffSourceWorkspaceTransfer({
        handoffId: 'handoff_1',
        activeServerDir,
        negotiatedTransportStrategy: 'server_routed_stream',
        workspaceTransfer,
        sourceRootPath,
      });

      expect(result.handoffMetadataV2?.workspaceReplicationSourceRootPath).toBe(sourceRootPath);
      expect(result.handoffMetadataV2?.workspaceReplicationManifestTransferPublication?.transferId).toEqual(expect.any(String));
      expect(result.handoffMetadataV2?.workspaceReplicationManifestTransferPublication?.endpointCandidates).toBeUndefined();
    } finally {
      await rm(activeServerDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('includes referenced generated media from ignored workspace uploads without including unrelated uploads', async () => {
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-handoff-source-transfer-'));
    const sourceRootPath = await mkdtemp(join(tmpdir(), 'happier-handoff-source-root-'));
    try {
      await mkdir(join(sourceRootPath, '.happier', 'uploads', 'generated', 'message-1'), { recursive: true });
      await mkdir(join(sourceRootPath, '.happier', 'uploads', 'generated', 'message-2'), { recursive: true });
      await writeFile(join(sourceRootPath, '.gitignore'), '.happier/uploads/**\n');
      await writeFile(join(sourceRootPath, 'README.md'), 'hello\n');
      await writeFile(join(sourceRootPath, '.happier', 'uploads', 'generated', 'message-1', 'image[1].png'), 'referenced\n');
      await writeFile(join(sourceRootPath, '.happier', 'uploads', 'generated', 'message-2', 'unrelated.png'), 'unrelated\n');
      await runGit(sourceRootPath, ['init']);
      await runGit(sourceRootPath, ['config', 'user.email', 'test@example.com']);
      await runGit(sourceRootPath, ['config', 'user.name', 'Happier Test']);
      await runGit(sourceRootPath, ['add', 'README.md', '.gitignore']);
      await runGit(sourceRootPath, ['commit', '-m', 'initial']);

      const workspaceTransfer: SessionHandoffWorkspaceTransfer = {
        enabled: true,
        strategy: 'transfer_snapshot',
        conflictPolicy: 'replace_existing',
        includeIgnoredMode: 'exclude',
        ignoredIncludeGlobs: [],
      };

      const result = await prepareSessionHandoffSourceWorkspaceTransfer({
        handoffId: 'handoff_1',
        activeServerDir,
        negotiatedTransportStrategy: 'server_routed_stream',
        workspaceTransfer,
        sourceRootPath,
        sessionTranscriptRecords: [
          {
            meta: {
              happier: {
                kind: 'session_media.v1',
                payload: {
                  media: [
                    {
                      role: 'output',
                      category: 'generated',
                      mediaKind: 'image',
                      path: '.happier/uploads/generated/message-1/image[1].png',
                    },
                  ],
                },
              },
            },
          },
        ],
      });

      const manifestPaths = result.workspaceReplicationMetadata?.manifest.entries.map((entry) => entry.relativePath) ?? [];

      expect(manifestPaths).toContain('.happier/uploads/generated/message-1/image[1].png');
      expect(manifestPaths).not.toContain('.happier/uploads/generated/message-2/unrelated.png');
    } finally {
      await rm(activeServerDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(sourceRootPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('derives referenced media paths from the exported provider transcript bundle', async () => {
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-handoff-source-transfer-'));
    const sourceRootPath = await mkdtemp(join(tmpdir(), 'happier-handoff-source-root-'));
    try {
      await mkdir(join(sourceRootPath, '.happier', 'uploads', 'artifacts', 'message-1'), { recursive: true });
      await mkdir(join(sourceRootPath, '.happier', 'uploads', 'artifacts', 'message-2'), { recursive: true });
      await writeFile(join(sourceRootPath, '.gitignore'), '.happier/uploads/**\n');
      await writeFile(join(sourceRootPath, 'README.md'), 'hello\n');
      await writeFile(join(sourceRootPath, '.happier', 'uploads', 'artifacts', 'message-1', 'plot?.png'), 'referenced\n');
      await writeFile(join(sourceRootPath, '.happier', 'uploads', 'artifacts', 'message-2', 'unrelated.png'), 'unrelated\n');
      await runGit(sourceRootPath, ['init']);
      await runGit(sourceRootPath, ['config', 'user.email', 'test@example.com']);
      await runGit(sourceRootPath, ['config', 'user.name', 'Happier Test']);
      await runGit(sourceRootPath, ['add', 'README.md', '.gitignore']);
      await runGit(sourceRootPath, ['commit', '-m', 'initial']);

      const transcript = `${JSON.stringify({
        meta: {
          happierMedia: {
            kind: 'session_media.v1',
            payload: {
              media: [
                {
                  role: 'output',
                  category: 'tool-artifact',
                  mediaKind: 'image',
                  path: '.happier/uploads/artifacts/message-1/plot?.png',
                },
              ],
            },
          },
        },
      })}\n`;

      const result = await prepareSessionHandoffSourceWorkspaceTransfer({
        handoffId: 'handoff_1',
        activeServerDir,
        negotiatedTransportStrategy: 'server_routed_stream',
        workspaceTransfer: {
          enabled: true,
          strategy: 'transfer_snapshot',
          conflictPolicy: 'replace_existing',
          includeIgnoredMode: 'exclude',
          ignoredIncludeGlobs: [],
        },
        sourceRootPath,
        providerBundle: {
          providerId: 'claude',
          remoteSessionId: 'claude_session_1',
          transcriptBase64: Buffer.from(transcript, 'utf8').toString('base64'),
        },
      });

      const manifestPaths = result.workspaceReplicationMetadata?.manifest.entries.map((entry) => entry.relativePath) ?? [];

      expect(manifestPaths).toContain('.happier/uploads/artifacts/message-1/plot?.png');
      expect(manifestPaths).not.toContain('.happier/uploads/artifacts/message-2/unrelated.png');
    } finally {
      await rm(activeServerDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(sourceRootPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('includes endpoint candidates in the manifest transfer publication when negotiated transport is direct_peer', async () => {
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-handoff-source-transfer-'));
    const sourceRootPath = await mkdtemp(join(tmpdir(), 'happier-handoff-source-root-'));
    try {
      await mkdir(join(sourceRootPath, 'nested'), { recursive: true });
      await writeFile(join(sourceRootPath, 'README.md'), 'hello\n');
      await writeFile(join(sourceRootPath, 'nested', 'note.txt'), 'note\n');

      const workspaceTransfer: SessionHandoffWorkspaceTransfer = {
        enabled: true,
        strategy: 'transfer_snapshot',
        conflictPolicy: 'replace_existing',
        includeIgnoredMode: 'exclude',
        ignoredIncludeGlobs: [],
      };

      const result = await prepareSessionHandoffSourceWorkspaceTransfer({
        handoffId: 'handoff_1',
        activeServerDir,
        negotiatedTransportStrategy: 'direct_peer',
        workspaceTransfer,
        sourceRootPath,
        providerBundleTransferPublication: {
          transferId: 'provider_bundle_1',
          sizeBytes: 123,
          manifestHash: 'sha256:provider_bundle_1',
          endpointCandidates: [
            {
              kind: 'http',
              url: 'http://127.0.0.1:46001/machine-transfers/direct/provider_bundle_1?token=aaa#ignored',
              authorizationToken: 'token_1',
              expiresAt: Date.now() + 60_000,
            },
          ],
        },
      });

      const manifestTransferId = result.handoffMetadataV2?.workspaceReplicationManifestTransferPublication?.transferId;
      expect(manifestTransferId).toEqual(expect.any(String));
      const expectedEncodedKey = Buffer.from(String(manifestTransferId), 'utf8').toString('base64url');

      expect(result.handoffMetadataV2?.workspaceReplicationManifestTransferPublication).toEqual({
        transferId: expect.any(String),
        endpointCandidates: [
          {
            kind: 'http',
            url: `http://127.0.0.1:46001/machine-transfers/direct/${expectedEncodedKey}`,
            authorizationToken: 'token_1',
            expiresAt: expect.any(Number),
          },
        ],
      });
    } finally {
      await rm(activeServerDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('fails closed when the workspace transfer source root is missing', async () => {
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-handoff-source-transfer-'));
    const sourceRootPath = await mkdtemp(join(tmpdir(), 'happier-handoff-source-root-missing-'));
    try {
      await rm(sourceRootPath, { recursive: true, force: true });

      const workspaceTransfer: SessionHandoffWorkspaceTransfer = {
        enabled: true,
        strategy: 'transfer_snapshot',
        conflictPolicy: 'replace_existing',
        includeIgnoredMode: 'exclude',
        ignoredIncludeGlobs: [],
      };

      await expect(prepareSessionHandoffSourceWorkspaceTransfer({
        handoffId: 'handoff_1',
        activeServerDir,
        negotiatedTransportStrategy: 'server_routed_stream',
        workspaceTransfer,
        sourceRootPath,
      })).rejects.toMatchObject({
        code: 'source_path_unreadable',
        sourcePath: sourceRootPath,
      });
    } finally {
      await rm(activeServerDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('returns no handoffMetadataV2 when workspace transfer is disabled', async () => {
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-handoff-source-transfer-'));
    try {
      const result = await prepareSessionHandoffSourceWorkspaceTransfer({
        handoffId: 'handoff_1',
        activeServerDir,
        negotiatedTransportStrategy: 'server_routed_stream',
        workspaceTransfer: {
          enabled: false,
          strategy: 'transfer_snapshot',
          conflictPolicy: 'create_sibling_copy',
          includeIgnoredMode: 'exclude',
          ignoredIncludeGlobs: [],
        },
        sourceRootPath: '/source',
      });

      expect(result.handoffMetadataV2).toBeUndefined();
    } finally {
      await rm(activeServerDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
