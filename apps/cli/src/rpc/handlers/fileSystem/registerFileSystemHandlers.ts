import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { configuration } from '@/configuration';

import { registerReadFileHandler } from './readFileHandler';
import { registerWriteFileHandler } from './writeFileHandler';
import { registerDirectoryHandlers } from './directoryHandlers';
import { registerPathMutationHandlers } from './pathMutationHandlers';
import { registerSessionTransferRpcHandlers } from '@/transfers/rpc/registerSessionTransferRpcHandlers';
import { resolveSessionRpcTransferMaxBytes } from '@/transfers/policy/sessionRpcTransferPolicy';
import { createTransferPathAllowanceRegistry } from '@/transfers/targets/createTransferPathAllowanceRegistry';
import { resolveDirectGeneratedMediaDirectory } from '@/transfers/targets/materializeDirectGeneratedMedia';
import { TransferSessionStore } from '@/transfers/core/transferSessionStore';
import {
  type FilesystemAccessPolicy,
  resolveFilesystemPolicyDefaultDirectory,
} from './accessPolicy/filesystemAccessPolicy';

function normalizeAllowedDirectories(getDirectories?: () => ReadonlyArray<string>): string[] {
  const value = getDirectories?.() ?? [];
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

/** 注册现有机器文件能力；生成图片只追加产品自有缓存的读取权限。 */
export function registerFileSystemHandlers(
  rpcHandlerManager: RpcHandlerRegistrar,
  workingDirectory: string,
  opts?: Readonly<{
    accessPolicy?: FilesystemAccessPolicy;
    getAdditionalAllowedReadDirs?: () => ReadonlyArray<string>;
    getAdditionalAllowedWriteDirs?: () => ReadonlyArray<string>;
  }>,
): Readonly<{
  transferSessionStore: TransferSessionStore;
  attachmentUploadMaxBytes?: number;
  dispose: () => Promise<void>;
}> {
  const accessPolicy: FilesystemAccessPolicy = opts?.accessPolicy ?? { kind: 'osUser' };
  const effectiveWorkingDirectory = resolveFilesystemPolicyDefaultDirectory({
    defaultDirectory: workingDirectory,
    accessPolicy,
  });
  const getAdditionalAllowedReadDirs = () => [
    ...normalizeAllowedDirectories(opts?.getAdditionalAllowedReadDirs),
    resolveDirectGeneratedMediaDirectory(),
  ];
  const getAdditionalAllowedWriteDirs = opts?.getAdditionalAllowedWriteDirs;
  const pathAllowanceRegistry = createTransferPathAllowanceRegistry({
    onReadDirsChange: () => {},
    onWriteDirsChange: () => {},
  });
  const transferSessionStore = new TransferSessionStore({ ttlMs: configuration.filesTransferSessionTtlMs });

  registerReadFileHandler(rpcHandlerManager, {
    defaultDirectory: effectiveWorkingDirectory,
    accessPolicy,
    getAdditionalAllowedReadDirs: () => normalizeAllowedDirectories(getAdditionalAllowedReadDirs),
  });
  registerWriteFileHandler(rpcHandlerManager, {
    defaultDirectory: effectiveWorkingDirectory,
    accessPolicy,
    getAdditionalAllowedWriteDirs: () => normalizeAllowedDirectories(getAdditionalAllowedWriteDirs),
  });
  registerDirectoryHandlers(rpcHandlerManager, {
    defaultDirectory: effectiveWorkingDirectory,
    accessPolicy,
    getAdditionalAllowedReadDirs: () => normalizeAllowedDirectories(getAdditionalAllowedReadDirs),
    getAdditionalAllowedWriteDirs: () => normalizeAllowedDirectories(getAdditionalAllowedWriteDirs),
  });
  registerPathMutationHandlers(rpcHandlerManager, {
    defaultDirectory: effectiveWorkingDirectory,
    accessPolicy,
    getAdditionalAllowedReadDirs: () => normalizeAllowedDirectories(getAdditionalAllowedReadDirs),
    getAdditionalAllowedWriteDirs: () => normalizeAllowedDirectories(getAdditionalAllowedWriteDirs),
  });
  // 公布同一传输注册快照的单文件上限，不另读环境或替换原上传拒绝顺序。
  const sessionRpcTransferMaxBytes = resolveSessionRpcTransferMaxBytes();
  const attachmentUploadMaxBytes = Math.min(
    configuration.filesUploadMaxFileBytes,
    sessionRpcTransferMaxBytes ?? configuration.filesUploadMaxFileBytes,
  );
  registerSessionTransferRpcHandlers(rpcHandlerManager, {
    workingDirectory: effectiveWorkingDirectory,
    accessPolicy,
    store: transferSessionStore,
    getAdditionalAllowedReadDirs,
    getAdditionalAllowedWriteDirs,
    sessionRpcTransferMaxBytes,
    attachmentUpload: {
      pathAllowanceRegistry,
    },
  });

  return {
    transferSessionStore,
    ...(Number.isSafeInteger(attachmentUploadMaxBytes) && attachmentUploadMaxBytes > 0 ? { attachmentUploadMaxBytes } : {}),
    dispose: () => transferSessionStore.dispose(),
  };
}
