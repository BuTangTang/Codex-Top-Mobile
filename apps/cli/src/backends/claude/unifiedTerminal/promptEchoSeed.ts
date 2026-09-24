import type { SessionClientPort } from '@/api/session/sessionClientPort';
import { logger } from '@/ui/logger';
import type { ClaudeOwnComposerTextLog } from './ownComposerTextLog';
import type { ClaudeUnifiedPromptEchoSuppressor } from './promptEchoSuppression';

export const CLAUDE_UNIFIED_PROMPT_ECHO_SEED_TAKE = 500;

export async function seedClaudeUnifiedPersistedPromptEchoes(params: Readonly<{
  session: Pick<SessionClientPort, 'fetchRecentTranscriptTextItemsForAcpImport'>;
  suppressor: Pick<ClaudeUnifiedPromptEchoSuppressor, 'recordPersistedUserPromptTexts'>;
  /**
   * C11 (incident cmq8y3nlx): the own-injected-text registry is in-memory, so a respawned runner
   * cannot recognize its predecessor's leftover composer injection as its own (→ honest but
   * unresolvable draft-veto starvation). Every injected prompt is a UI-origin user message and is
   * persisted server-side, so seeding the registry from the same persisted user-prompt source the
   * echo suppressor uses lets the successor classify (and clear) predecessor leftovers.
   */
  ownComposerTexts?: Pick<ClaudeOwnComposerTextLog, 'record'> | undefined;
  logPrefix: string;
  nowMs?: number;
}>): Promise<void> {
  if (typeof params.session.fetchRecentTranscriptTextItemsForAcpImport !== 'function') return;
  const suppressBeforeMs = params.nowMs ?? Date.now();
  try {
    const items = await params.session.fetchRecentTranscriptTextItemsForAcpImport({
      take: CLAUDE_UNIFIED_PROMPT_ECHO_SEED_TAKE,
    });
    const userItems = items.filter((item) => item.role === 'user');
    params.suppressor.recordPersistedUserPromptTexts(
      userItems.map((item) => ({ text: item.text, suppressBeforeMs })),
    );
    if (params.ownComposerTexts) {
      // Items are chronological; the bounded registry keeps the most recent entries, which is
      // exactly where a predecessor's leftover injection lives.
      for (const item of userItems) {
        params.ownComposerTexts.record(item.text);
      }
    }
  } catch (error) {
    logger.debug(`${params.logPrefix}: failed to seed Claude unified persisted prompt echoes`, error);
  }
}
