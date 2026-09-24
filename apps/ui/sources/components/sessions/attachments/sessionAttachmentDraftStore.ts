import type { AttachmentDraft } from './attachmentDraftModel';
import {
    clearAttachmentDraftsFromMemory,
    readAttachmentDraftsFromMemory,
    writeAttachmentDraftsToMemory,
} from './attachmentDraftMemoryStore';

function buildSessionAttachmentDraftKey(sessionId: string | null | undefined): string | null {
    if (typeof sessionId !== 'string') return null;
    const trimmed = sessionId.trim();
    return trimmed.length > 0 ? `session:${trimmed}` : null;
}

export function readSessionAttachmentDrafts(sessionId: string | null | undefined): readonly AttachmentDraft[] {
    return readAttachmentDraftsFromMemory(buildSessionAttachmentDraftKey(sessionId));
}

export function writeSessionAttachmentDrafts(
    sessionId: string | null | undefined,
    drafts: readonly AttachmentDraft[],
): void {
    writeAttachmentDraftsToMemory(buildSessionAttachmentDraftKey(sessionId), drafts);
}

export function clearSessionAttachmentDrafts(sessionId: string | null | undefined): void {
    clearAttachmentDraftsFromMemory(buildSessionAttachmentDraftKey(sessionId));
}
