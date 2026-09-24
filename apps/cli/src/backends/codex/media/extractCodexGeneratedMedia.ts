import type { SessionMediaSource } from '@/agent/core/AgentMessage';
import {
  sniffSessionMediaMimeTypeFromBase64,
} from '@/session/sessionMedia/sessionMediaMime';

type ExtractCodexGeneratedMediaOptions = Readonly<{
  maxRevisedPromptChars?: number;
}>;

const DEFAULT_MAX_REVISED_PROMPT_CHARS = 2_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function sanitizeCodexRevisedPrompt(
  value: unknown,
  options: ExtractCodexGeneratedMediaOptions = {},
): string | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  const maxChars = Math.max(1, Math.trunc(options.maxRevisedPromptChars ?? DEFAULT_MAX_REVISED_PROMPT_CHARS));
  const sanitized = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return sanitized.length > maxChars ? sanitized.slice(0, maxChars).trim() : sanitized;
}

export function extractCodexGeneratedMedia(
  value: unknown,
  options: ExtractCodexGeneratedMediaOptions = {},
): SessionMediaSource[] {
  const record = asRecord(value);
  if (!record) return [];
  const generationId = readString(record.id) ?? readString(record.itemId) ?? readString(record.call_id);
  if (!generationId) return [];

  const revisedPrompt = sanitizeCodexRevisedPrompt(record.revised_prompt ?? record.revisedPrompt, options);
  const provenance = revisedPrompt ? { revisedPrompt } : undefined;
  const origin = {
    source: 'provider-generated' as const,
    generationId,
    providerEventId: generationId,
  };

  const media: SessionMediaSource[] = [];
  const result = readString(record.result) ?? readString(record.image) ?? readString(record.image_b64);
  const savedPath = readString(record.saved_path) ?? readString(record.savedPath);
  const status = readString(record.status)?.toLowerCase();
  if (status && status !== 'completed' && status !== 'succeeded' && !result && !savedPath) return [];

  if (savedPath) {
    media.push({
      kind: 'local-file',
      path: savedPath,
      origin,
      dedupeKey: `codex:image-generation:${generationId}:saved_path`,
      ...(provenance ? { provenance } : {}),
    });
    return media;
  }

  if (result) {
    const mimeType = sniffSessionMediaMimeTypeFromBase64(result);
    if (mimeType) {
      media.push({
        kind: 'base64',
        data: result,
        mimeType,
        origin,
        dedupeKey: `codex:image-generation:${generationId}:result`,
        ...(provenance ? { provenance } : {}),
      });
    }
  }

  return media;
}
