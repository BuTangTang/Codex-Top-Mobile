import { extname } from 'node:path';

const MAX_SAFE_FILE_NAME_LENGTH = 200;

export function sanitizeSessionMediaFileName(value: string, fallback = 'file'): string {
    const raw = String(value ?? '');
    const base = raw.split(/[/\\]/g).pop() ?? '';
    const trimmed = base.trim() || fallback;
    const safe = trimmed.replace(/[^\w.\- ()]/g, '_');
    const collapsed = safe.replace(/_+/g, '_');
    const finalName = collapsed === '.' || collapsed === '..' ? fallback : collapsed;
    return finalName.length > MAX_SAFE_FILE_NAME_LENGTH
        ? finalName.slice(-MAX_SAFE_FILE_NAME_LENGTH)
        : finalName;
}

export function normalizeSessionMediaPathSegment(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed === '.' || trimmed === '..') return null;
    if (trimmed.includes('\0')) return null;
    if (trimmed.includes('/') || trimmed.includes('\\')) return null;
    return trimmed;
}

export function withSessionMediaFileExtension(fileName: string, extensionWithDot: string): string {
    const safeExtension = extensionWithDot.startsWith('.') ? extensionWithDot : `.${extensionWithDot}`;
    const currentExtension = extname(fileName);
    const base = currentExtension ? fileName.slice(0, -currentExtension.length) : fileName;
    return `${base || 'file'}${safeExtension}`;
}
