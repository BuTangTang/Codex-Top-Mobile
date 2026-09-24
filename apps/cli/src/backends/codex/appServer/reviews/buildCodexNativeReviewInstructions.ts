import type { ReviewStartInput } from '@happier-dev/protocol';

import { buildReviewScopeGuidanceBlock } from '@/agent/reviews/prompt/buildReviewScopeGuidanceBlock';

export function buildCodexNativeReviewInstructions(input: ReviewStartInput): string {
  const userInstructions = input.instructions.trim();
  const scopeBlock = buildReviewScopeGuidanceBlock(input);
  return [
    userInstructions.length > 0 ? userInstructions : 'Review the scoped changes.',
    scopeBlock,
  ].filter((line): line is string => typeof line === 'string' && line.trim().length > 0).join('\n\n').trim();
}
