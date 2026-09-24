import { configuration } from '@/configuration';
import type { FilesystemAccessPolicy } from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy';
import { authorizeFilesystemPath } from '@/rpc/handlers/fileSystem/accessPolicy/filesystemPathAuthorization';

import {
    isServerRoutedTransferOverSizeLimit,
    SESSION_RPC_FILE_TRANSFER_SIZE_LIMIT_ERROR,
} from '../policy/sessionRpcTransferPolicy';
import { finalizeWorkspaceFileUpload } from './finalizeWorkspaceFileUpload';
import type { UploadTransferTarget } from './uploadTransferTarget';

export type WorkspaceFileUploadTarget = UploadTransferTarget & Readonly<{
    destPath: string;
}>;

type WorkspaceFileUploadTargetResult =
    | Readonly<{ success: true; target: WorkspaceFileUploadTarget }>
    | Readonly<{ success: false; error: string }>;

function normalizeSizeBytes(value: unknown): number | null {
    const raw = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(raw)) return null;
    const sizeBytes = Math.floor(raw);
    if (sizeBytes < 0) return null;
    return sizeBytes;
}

export function resolveWorkspaceFileUploadTarget(input: Readonly<{
    workingDirectory: string;
    accessPolicy?: FilesystemAccessPolicy;
    path: unknown;
    sizeBytes: unknown;
    overwrite: unknown;
    additionalAllowedWriteDirs?: readonly string[];
    sessionRpcTransferMaxBytes?: number | null;
}>): WorkspaceFileUploadTargetResult {
    const path = typeof input.path === 'string' ? input.path : '';
    const sizeBytes = normalizeSizeBytes(input.sizeBytes);
    const overwrite = Boolean(input.overwrite);

    if (!path) {
        return { success: false, error: 'Missing path' };
    }
    if (sizeBytes === null) {
        return { success: false, error: 'Invalid sizeBytes' };
    }
    if (isServerRoutedTransferOverSizeLimit(sizeBytes, input.sessionRpcTransferMaxBytes ?? null)) {
        return { success: false, error: SESSION_RPC_FILE_TRANSFER_SIZE_LIMIT_ERROR };
    }
    if (sizeBytes > configuration.filesUploadMaxFileBytes) {
        return { success: false, error: 'File exceeds upload size limit' };
    }

    const validation = authorizeFilesystemPath({
        targetPath: path,
        defaultDirectory: input.workingDirectory,
        accessPolicy: input.accessPolicy ?? { kind: 'osUser' },
        additionalAllowedDirs: input.additionalAllowedWriteDirs,
    });
    if (!validation.valid) {
        return { success: false, error: validation.error };
    }
    const destPath = validation.resolvedPath;

    return {
        success: true,
        target: {
            destPath,
            destDisplayPath: path,
            expectedSizeBytes: sizeBytes,
            overwrite,
            finalizeUpload: async ({ tempPath, sizeBytes: finalizedSizeBytes }) =>
                await finalizeWorkspaceFileUpload({
                    tempPath,
                    destPath,
                    destDisplayPath: path,
                    overwrite,
                    sizeBytes: finalizedSizeBytes,
                }),
        },
    };
}
