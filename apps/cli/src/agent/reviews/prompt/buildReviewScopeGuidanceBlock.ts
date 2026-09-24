import { ReviewStartInputSchema } from '@happier-dev/protocol';

export function buildReviewScopeGuidanceBlock(intentInput: unknown): string | null {
  const parsed = ReviewStartInputSchema.safeParse(intentInput);
  if (!parsed.success) return null;

  const payload = parsed.data;
  const baseLine = payload.base.kind === 'branch'
    ? `Base branch: ${payload.base.baseBranch}`
    : payload.base.kind === 'commit'
      ? `Base commit: ${payload.base.baseCommit}`
      : 'Base: infer the repository\'s normal comparison base from the current branch context.';
  const scopeInstruction = payload.changeType === 'uncommitted'
    ? 'Focus on the current uncommitted worktree changes, including untracked files when they are relevant to the review.'
    : payload.changeType === 'all'
      ? 'Review both the committed diff for the selected base and the current uncommitted worktree changes.'
      : 'Focus on the committed changes for the selected review base.';

  return [
    'Review scope:',
    `- Change type: ${payload.changeType}`,
    `- ${baseLine}`,
    `- ${scopeInstruction}`,
    '- Do not broaden the review to unrelated repository areas unless they are directly needed to validate a scoped finding.',
  ].join('\n');
}
