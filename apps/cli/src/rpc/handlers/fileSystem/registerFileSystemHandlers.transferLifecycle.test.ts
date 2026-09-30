import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { describe, expect, it, vi } from 'vitest';

import type { RpcHandler, RpcHandlerRegistrar } from '@/api/rpc/types';
import { createTransferRecipientKeyPair } from '@/machines/transfer/transferChunkEncryption';
import { configuration } from '@/configuration';

import { registerFileSystemHandlers } from './registerFileSystemHandlers';

function createRegistrar(): { handlers: Map<string, RpcHandler>; registrar: RpcHandlerRegistrar } {
  const handlers = new Map<string, RpcHandler>();
  return {
    handlers,
    registrar: {
      registerHandler(method, handler) {
        handlers.set(method, handler);
      },
    },
  };
}

async function expectPathMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('registerFileSystemHandlers transfer lifecycle ownership', () => {
  // 公布值必须对应同一注册的真实上传边界，后改环境不能替换已注册的路由快照。
  it.each([
    { routed: 1024, file: 2048, expected: 1024, error: 'File exceeds the server-routed transfer size limit' },
    { routed: 8192, file: 2048, expected: 2048, error: 'File exceeds upload size limit' },
  ])('exposes the registered attachment upload limit ($routed/$file)', async ({ routed, file, expected, error }) => {
    const workspace = await mkdtemp(join(tmpdir(), 'happier-upload-capability-'));
    const previousFileLimit = configuration.filesUploadMaxFileBytes;
    const mutableConfiguration = configuration as { filesUploadMaxFileBytes: number };
    mutableConfiguration.filesUploadMaxFileBytes = file;
    vi.stubEnv('HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES', String(routed));
    const { handlers, registrar } = createRegistrar();
    const registration = registerFileSystemHandlers(registrar, workspace);
    try {
      expect(registration).toHaveProperty('attachmentUploadMaxBytes', expected);
      vi.stubEnv('HAPPIER_FEATURE_MACHINES_TRANSFER_SERVER_ROUTED__MAX_BYTES', '1');
      const upload = handlers.get(RPC_METHODS.DAEMON_BULK_TRANSFER_UPLOAD_INIT)!;
      const request = { t: 'session_attachment_upload_v1', messageLocalId: 'fixture', fileName: 'fixture.txt',
        workspaceRootPath: workspace, uploadLocation: 'os_temp', vcsIgnoreWritesEnabled: false };
      await expect(upload({ ...request, sizeBytes: expected })).resolves.toMatchObject({ success: true, uploadId: expect.any(String) });
      await expect(upload({ ...request, sizeBytes: expected + 1 })).resolves.toEqual({ success: false, error });
    } finally {
      await registration.dispose();
      mutableConfiguration.filesUploadMaxFileBytes = previousFileLimit;
      vi.unstubAllEnvs();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('disposes abandoned upload and download resources when the filesystem handler owner shuts down', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'happier-filesystem-transfer-owner-'));
    const { handlers, registrar } = createRegistrar();

    try {
      const registration = registerFileSystemHandlers(registrar, workspace);

      const uploadInit = handlers.get(RPC_METHODS.DAEMON_BULK_TRANSFER_UPLOAD_INIT);
      const downloadInit = handlers.get(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT);
      if (!uploadInit || !downloadInit) {
        throw new Error('expected transfer init handlers');
      }

      const uploadInitResult = await uploadInit({
        t: 'session_file_upload_v1',
        path: 'abandoned-upload.txt',
        sizeBytes: 4,
        overwrite: false,
      });
      expect(uploadInitResult).toMatchObject({ success: true, uploadId: expect.any(String) });
      const uploadId = (uploadInitResult as { uploadId: string }).uploadId;
      const uploadSession = registration.transferSessionStore.getUploadSession(uploadId);
      expect(uploadSession).toBeTruthy();
      const uploadTempPath = uploadSession?.tempPath ?? '';
      await expect(access(uploadTempPath)).resolves.toBeUndefined();

      const downloadDir = join(workspace, 'download-dir');
      await mkdir(downloadDir, { recursive: true });
      await writeFile(join(downloadDir, 'source.txt'), 'download me', 'utf8');
      const recipient = createTransferRecipientKeyPair();
      const downloadInitResult = await downloadInit({
        t: 'session_file_download_v1',
        path: 'download-dir',
        asZip: true,
        recipientPublicKeyBase64: recipient.recipientPublicKeyBase64,
      });
      expect(downloadInitResult).toMatchObject({ success: true, downloadId: expect.any(String) });
      const downloadId = (downloadInitResult as { downloadId: string }).downloadId;
      const downloadSession = registration.transferSessionStore.getDownloadSession(downloadId);
      expect(downloadSession).toBeTruthy();
      const downloadTempPath = downloadSession?.filePath ?? '';
      await expect(access(downloadTempPath)).resolves.toBeUndefined();

      await registration.dispose();
      await registration.dispose();

      expect(registration.transferSessionStore.getUploadSession(uploadId)).toBeNull();
      expect(registration.transferSessionStore.getDownloadSession(downloadId)).toBeNull();
      await expectPathMissing(uploadTempPath);
      await expectPathMissing(downloadTempPath);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
