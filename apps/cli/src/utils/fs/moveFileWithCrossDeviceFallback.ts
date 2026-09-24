import { copyFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const CROSS_DEVICE_STAGING_PREFIX = '.happier-upload-stage-';

function readErrorCode(error: unknown): string | null {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return null;
    }
    return typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null;
}

export async function moveFileWithCrossDeviceFallback(sourcePath: string, destPath: string): Promise<void> {
    try {
        await rename(sourcePath, destPath);
        return;
    } catch (error) {
        if (readErrorCode(error) !== 'EXDEV') {
            throw error;
        }
    }

    const stagedDestPath = join(
        dirname(destPath),
        `${CROSS_DEVICE_STAGING_PREFIX}${basename(destPath)}.${randomUUID()}.tmp`,
    );

    try {
        await copyFile(sourcePath, stagedDestPath);
        await rename(stagedDestPath, destPath);
    } catch (error) {
        await rm(stagedDestPath, { force: true }).catch(() => undefined);
        throw error;
    }

    await rm(sourcePath, { force: true }).catch(() => undefined);
}
