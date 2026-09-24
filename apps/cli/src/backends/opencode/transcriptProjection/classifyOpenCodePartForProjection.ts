import {
  asOpenCodeProjectionRecord,
  hasOpenCodeInternalFlag,
  normalizeOpenCodeProjectionLowerString,
  normalizeOpenCodeProjectionString,
} from './openCodeProjectionParsing';
import type { OpenCodePartProjection, OpenCodeTranscriptProjectionContext } from './openCodeTranscriptProjectionTypes';

const TRANSCRIPT_PART_TYPES = new Set(['text', 'step']);

export function classifyOpenCodePartForProjection(
  part: unknown,
  opts: Readonly<{ context: OpenCodeTranscriptProjectionContext }>,
): OpenCodePartProjection {
  const rec = asOpenCodeProjectionRecord(part);
  if (!rec) return { kind: 'non_transcript', text: '', partType: '' };

  const partType = normalizeOpenCodeProjectionLowerString(rec.type);
  const text = normalizeOpenCodeProjectionString(rec.text);

  if (hasOpenCodeInternalFlag(rec)) {
    return { kind: 'ignored_internal', text: '', partType };
  }

  if (partType === 'reasoning') {
    return opts.context === 'live_transcript'
      ? { kind: 'reasoning_text', text, partType }
      : { kind: 'non_transcript', text: '', partType };
  }

  if (!TRANSCRIPT_PART_TYPES.has(partType)) {
    return { kind: 'non_transcript', text: '', partType };
  }

  return text.trim().length > 0
    ? { kind: 'transcript_text', text, partType }
    : { kind: 'non_transcript', text: '', partType };
}
