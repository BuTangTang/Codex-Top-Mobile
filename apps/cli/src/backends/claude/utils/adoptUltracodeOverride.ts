import type { Metadata } from '@/api/types';

import { resolveSessionConfigOptionOverridesFromMetadataSnapshot } from '@/agent/runtime/sessionConfigOptionOverrideSync';

/**
 * Adoption helpers for the `ultracode` boolean config option (session-only Claude Code
 * setting). Mirrors the `reasoning_effort` adoption pair: durable session metadata
 * overrides plus per-message meta overrides, newest timestamp wins.
 */

function normalizeUltracodeValue(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return null;
}

export function adoptUltracodeOverrideFromMetadata(opts: Readonly<{
  currentValue: boolean | null;
  currentUpdatedAt: number;
  metadata: Metadata | null | undefined;
}>): { value: boolean | null; updatedAt: number; didChange: boolean } {
  const candidates = resolveSessionConfigOptionOverridesFromMetadataSnapshot({ metadata: opts.metadata });
  let match: { configId: string; valueId: string; updatedAt: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.configId !== 'ultracode') continue;
    if (!match || candidate.updatedAt > match.updatedAt) {
      match = candidate;
    }
  }
  if (!match || match.updatedAt <= opts.currentUpdatedAt) {
    return { value: opts.currentValue, updatedAt: opts.currentUpdatedAt, didChange: false };
  }

  const value = normalizeUltracodeValue(match.valueId);
  if (value === null) {
    return { value: opts.currentValue, updatedAt: opts.currentUpdatedAt, didChange: false };
  }

  return { value, updatedAt: match.updatedAt, didChange: true };
}

export function adoptUltracodeOverrideFromMessageMeta(opts: Readonly<{
  currentValue: boolean | null;
  currentUpdatedAt: number;
  messageMeta: Record<string, unknown> | null | undefined;
  updatedAt: number;
}>): { value: boolean | null; updatedAt: number; didChange: boolean } {
  const meta = opts.messageMeta;
  if (!meta || !Object.prototype.hasOwnProperty.call(meta, 'ultracode')) {
    return { value: opts.currentValue, updatedAt: opts.currentUpdatedAt, didChange: false };
  }

  const value = normalizeUltracodeValue(meta.ultracode);
  if (value === null || opts.updatedAt <= opts.currentUpdatedAt) {
    return { value: opts.currentValue, updatedAt: opts.currentUpdatedAt, didChange: false };
  }

  return { value, updatedAt: opts.updatedAt, didChange: true };
}
