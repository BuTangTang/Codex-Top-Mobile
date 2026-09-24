import type { FilesystemAccessPolicy } from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy';

import {
  DEFAULT_SESSION_MEDIA_TRANSFER_CONFIG,
  normalizeSessionMediaUploadLocation,
  normalizeSessionMediaVcsIgnoreStrategy,
  normalizeSessionMediaWorkspaceRelativeDir,
  type SessionMediaTransferConfig,
  type SessionMediaUploadLocation,
  type SessionMediaVcsIgnoreStrategy,
} from '../sessionMedia/sessionMediaConfig';
import {
  resolveConfiguredSessionMediaTransferTarget,
  resolveSessionMediaTransferTarget,
  type ConfiguredSessionMediaTransferTargetResult,
  type SessionMediaTransferTarget,
} from '../sessionMedia/resolveSessionMediaTransferTarget';

export type AttachmentUploadLocation = SessionMediaUploadLocation;
export type AttachmentVcsIgnoreStrategy = SessionMediaVcsIgnoreStrategy;
export type AttachmentTransferConfig = SessionMediaTransferConfig;
export type AttachmentTransferTarget = SessionMediaTransferTarget;
export type ConfiguredAttachmentTransferTargetResult = ConfiguredSessionMediaTransferTargetResult;

export const DEFAULT_ATTACHMENT_TRANSFER_CONFIG: AttachmentTransferConfig = DEFAULT_SESSION_MEDIA_TRANSFER_CONFIG;

export const normalizeAttachmentUploadLocation = normalizeSessionMediaUploadLocation;
export const normalizeAttachmentVcsIgnoreStrategy = normalizeSessionMediaVcsIgnoreStrategy;
export const normalizeAttachmentWorkspaceRelativeDir = normalizeSessionMediaWorkspaceRelativeDir;

export function resolveAttachmentTransferTarget(
  config: AttachmentTransferConfig,
  tempUploadRoot: string,
): AttachmentTransferTarget {
  return resolveSessionMediaTransferTarget({
    config,
    tempUploadRoot,
    category: 'messages',
  });
}

export function resolveConfiguredAttachmentTransferTarget(input: Readonly<{
  config: AttachmentTransferConfig;
  tempUploadRoot: string;
  workingDirectory: string;
  accessPolicy?: FilesystemAccessPolicy;
}>): ConfiguredAttachmentTransferTargetResult {
  return resolveConfiguredSessionMediaTransferTarget({
    config: input.config,
    tempUploadRoot: input.tempUploadRoot,
    workingDirectory: input.workingDirectory,
    accessPolicy: input.accessPolicy,
    category: 'messages',
  });
}
