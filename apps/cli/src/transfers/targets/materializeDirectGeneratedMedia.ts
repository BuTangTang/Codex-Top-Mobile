import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DirectSessionAttachmentV1 } from '@happier-dev/protocol';
import { configuration } from '@/configuration';
import { extensionForSessionMediaMimeType, sniffSessionMediaMimeType } from '@/session/sessionMedia/sessionMediaMime';
import { resolveSessionRpcTransferMaxBytes } from '../policy/sessionRpcTransferPolicy';

/** 生成图片只存入当前服务的产品自有缓存，不能落入 Codex 或项目目录。 */
export function resolveDirectGeneratedMediaDirectory(): string {
  return join(configuration.activeServerDir, 'direct-generated-media');
}

/** 沿用实际下载通道的文件大小限制，不另设图片配额。 */
export function resolveDirectGeneratedMediaMaxBytes(): number {
  const routedMaxBytes = resolveSessionRpcTransferMaxBytes();
  return Math.min(configuration.filesDownloadMaxFileBytes, routedMaxBytes ?? Infinity);
}

/** 路径已含内容散列；命中时只查尺寸，避免历史分页重复读取整张图片。 */
async function hasReusableMedia(path: string, sizeBytes: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size === sizeBytes;
  } catch {
    return false;
  }
}

/** 将原始生成图片物化为既有传输描述，失败保持可见且不阻塞后续聊天记录。 */
export async function materializeDirectGeneratedMedia(input: Readonly<{
  sourceId: string;
  eventId: string;
  data: string;
}>): Promise<DirectSessionAttachmentV1> {
  const unavailable = (reason: string): DirectSessionAttachmentV1 => ({
    name: '生成图片', kind: 'image', availability: 'unavailable', reason,
  });
  let pendingPath: string | undefined;
  try {
    const maxBytes = resolveDirectGeneratedMediaMaxBytes();
    // 先检查编码长度，避免对超出既有下载能力的输入再分配完整解码缓冲。
    if (input.data.length > Math.ceil(maxBytes / 3) * 4) return unavailable('file_too_large');
    const bytes = Buffer.from(input.data, 'base64');
    if (bytes.length > maxBytes) return unavailable('file_too_large');
    const mimeType = sniffSessionMediaMimeType(bytes);
    if (!mimeType) return unavailable('unsupported_reference');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = createHash('sha256').update(JSON.stringify([input.sourceId, input.eventId, sha256])).digest('hex');
    const extension = extensionForSessionMediaMimeType(mimeType);
    const directory = resolveDirectGeneratedMediaDirectory();
    const path = join(directory, `${key}${extension}`);
    if (!(await hasReusableMedia(path, bytes.length))) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      pendingPath = join(directory, `.${key}-${randomUUID()}.part`);
      await writeFile(pendingPath, bytes, { flag: 'wx', mode: 0o600 });
      await rename(pendingPath, path);
      pendingPath = undefined;
    }
    return { name: `生成图片${extension}`, kind: 'image', path, mimeType, sizeBytes: bytes.length, sha256 };
  } catch {
    return unavailable('materialization_failed');
  } finally {
    if (pendingPath) await rm(pendingPath, { force: true }).catch(() => undefined);
  }
}
