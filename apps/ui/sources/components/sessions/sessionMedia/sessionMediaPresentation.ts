import { getImageMimeTypeFromPath } from '@/scm/utils/filePresentation';

import type { SessionMediaInlineImageSummary } from '@/sync/domains/sessionMedia/sessionMediaMessageMeta';

export function resolveSessionMediaImageMimeType(media: SessionMediaInlineImageSummary): string | null {
    if (typeof media.mimeType === 'string' && media.mimeType.startsWith('image/')) return media.mimeType;
    return getImageMimeTypeFromPath(media.path) ?? getImageMimeTypeFromPath(media.name);
}
