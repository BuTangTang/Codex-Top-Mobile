import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RpcHandler } from '@/api/rpc/types';
import { configuration, reloadConfiguration } from '@/configuration';
import { createTransferRecipientKeyPair, decryptEncryptedTransferChunkEnvelope } from '@/machines/transfer/transferChunkEncryption';
import { registerFileSystemHandlers } from '@/rpc/handlers/fileSystem/registerFileSystemHandlers';
import { materializeDirectGeneratedMedia, resolveDirectGeneratedMediaDirectory } from './materializeDirectGeneratedMedia';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2S0AAAAASUVORK5CYII=', 'base64');
const input = { sourceId: 'local-source/thread-one', eventId: 'generation-one', data: png.toString('base64') };

describe('direct generated media transfer ownership', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happier-direct-generated-media-'));
    vi.stubEnv('HAPPIER_HOME_DIR', join(root, 'happier'));
    reloadConfiguration();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    reloadConfiguration();
    await rm(root, { recursive: true, force: true });
  });

  it('reuses an immutable content path and preserves bytes, size and SHA without rewriting on repeat pages', async () => {
    const first = await materializeDirectGeneratedMedia(input);
    expect(first.availability).toBeUndefined();
    expect(first).toMatchObject({ kind: 'image', sizeBytes: png.length, mimeType: 'image/png',
      sha256: createHash('sha256').update(png).digest('hex') });
    expect(await readFile(first.path!)).toEqual(png);
    const oldTime = new Date('2020-01-01T00:00:00Z');
    await utimes(first.path!, oldTime, oldTime);
    expect(await materializeDirectGeneratedMedia(input)).toEqual(first);
    expect((await stat(first.path!)).mtimeMs).toBe(oldTime.getTime());
    const differentSource = await materializeDirectGeneratedMedia({ ...input, sourceId: 'other/thread' });
    expect(differentSource.path).not.toBe(first.path);
    expect(await readdir(resolveDirectGeneratedMediaDirectory())).toHaveLength(2);
  });

  it('uses the existing download limit and explicitly rejects oversized or non-image data', async () => {
    vi.stubEnv('HAPPIER_FILES_DOWNLOAD_MAX_FILE_BYTES', String(png.length - 1));
    reloadConfiguration();
    expect(await materializeDirectGeneratedMedia(input)).toEqual({ name: '生成图片', kind: 'image', availability: 'unavailable', reason: 'file_too_large' });
    expect(await materializeDirectGeneratedMedia({ ...input, data: Buffer.from('not an image').toString('base64') }))
      .toMatchObject({ availability: 'unavailable', reason: 'unsupported_reference' });
    await expect(stat(resolveDirectGeneratedMediaDirectory())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans a staged image if publication fails without replacing the pre-existing destination', async () => {
    const first = await materializeDirectGeneratedMedia(input);
    await rm(first.path!);
    await mkdir(first.path!);
    await writeFile(join(first.path!, 'keep.txt'), 'keep');
    expect(await materializeDirectGeneratedMedia(input)).toMatchObject({ availability: 'unavailable', reason: 'materialization_failed' });
    expect(await readFile(join(first.path!, 'keep.txt'), 'utf8')).toBe('keep');
    expect((await readdir(resolveDirectGeneratedMediaDirectory())).some((name) => name.endsWith('.part'))).toBe(false);
  });

  it('serves cached bytes through the existing encrypted bulk owner and permits only that extra read root', async () => {
    const image = await materializeDirectGeneratedMedia(input);
    const workspace = join(root, 'workspace');
    const legacyAllowed = join(root, 'legacy-read-root');
    await mkdir(workspace);
    await mkdir(legacyAllowed);
    const allowedFile = join(legacyAllowed, 'allowed.txt');
    await writeFile(allowedFile, 'allowed');
    const serverSibling = join(configuration.activeServerDir, 'not-media.txt');
    const unrelated = join(root, 'unrelated.txt');
    await writeFile(serverSibling, 'private');
    await writeFile(unrelated, 'outside');
    const symlinkPath = join(resolveDirectGeneratedMediaDirectory(), 'escape.txt');
    await symlink(unrelated, symlinkPath);
    const handlers = new Map<string, RpcHandler>();
    const owner = registerFileSystemHandlers({ registerHandler: (method, handler) => { handlers.set(method, handler); } }, workspace, {
      accessPolicy: { kind: 'restrictedRoots', roots: [workspace] },
      getAdditionalAllowedReadDirs: () => [legacyAllowed],
    });
    const recipient = createTransferRecipientKeyPair();
    const download = (path: string) => handlers.get(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT)!({
      t: 'session_file_download_v1', path, recipientPublicKeyBase64: recipient.recipientPublicKeyBase64,
    });
    try {
      const started = await download(image.path!) as { success: boolean; downloadId: string; sizeBytes: number };
      expect(started).toMatchObject({ success: true, sizeBytes: png.length });
      const chunk = await handlers.get(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK)!({ downloadId: started.downloadId, index: 0 }) as {
        success: boolean; payloadBase64: string; encryptedDataKeyEnvelopeBase64: string;
      };
      expect(chunk.success).toBe(true);
      const received = decryptEncryptedTransferChunkEnvelope({ transferId: started.downloadId, sequence: 0,
        payloadBase64: chunk.payloadBase64, encryptedDataKeyEnvelopeBase64: chunk.encryptedDataKeyEnvelopeBase64,
        recipientSecretKeySeed: recipient.recipientSecretKeySeed });
      expect(received).toEqual(png);
      expect(createHash('sha256').update(received).digest('hex')).toBe(image.sha256);
      expect(await handlers.get(RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_FINALIZE)!({ downloadId: started.downloadId })).toEqual({ success: true });
      expect(await download(allowedFile)).toMatchObject({ success: true });
      for (const path of [serverSibling, unrelated, symlinkPath]) expect(await download(path)).toMatchObject({ success: false });
      expect(await handlers.get(RPC_METHODS.WRITE_FILE)!({ path: join(resolveDirectGeneratedMediaDirectory(), 'write.txt'), content: 'eA==' }))
        .toMatchObject({ success: false });
    } finally {
      await owner.dispose();
    }
  });
});
