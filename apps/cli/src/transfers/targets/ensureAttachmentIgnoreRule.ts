import { ensureSessionMediaIgnoreRule } from '../sessionMedia/ensureSessionMediaIgnoreRule';
import type { AttachmentTransferConfig } from './resolveAttachmentTransferTarget';

export async function ensureAttachmentIgnoreRule(params: Readonly<{
    workingDirectory: string;
    config: AttachmentTransferConfig;
}>): Promise<void> {
    await ensureSessionMediaIgnoreRule(params);
}
