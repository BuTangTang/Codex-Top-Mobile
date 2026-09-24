import { randomUUID } from 'node:crypto';

import type { ApiSessionClient } from '@/api/session/sessionClient';
import type { ACPProvider } from '@/api/session/sessionMessageTypes';

import { classifyOpenCodeMessageForProjection, extractOpenCodeProjectedText } from '../transcriptProjection';
import { asRecord } from './openCodeParsing';

export type OpenCodeTextHistoryItem = Readonly<{
  messageId: string;
  role: 'user' | 'assistant';
  createdAtMs: number;
  text: string;
}>;

export function extractOpenCodeTextHistoryItems(rawMessages: unknown[]): OpenCodeTextHistoryItem[] {
  if (!Array.isArray(rawMessages)) return [];
  const items: OpenCodeTextHistoryItem[] = [];
  for (const msg of rawMessages) {
    const rec = asRecord(msg);
    if (!rec) continue;
    const projection = classifyOpenCodeMessageForProjection(rec);
    const role = projection.role;
    if (projection.kind !== 'user_transcript' && projection.kind !== 'assistant_transcript') continue;
    if (!role) continue;
    const messageId = projection.messageId;
    if (!messageId) continue;
    const parts = Array.isArray(rec.parts) ? rec.parts : [];
    const text = extractOpenCodeProjectedText(parts, { context: 'history_import' });
    if (!text) continue;
    items.push({
      messageId,
      role,
      createdAtMs: projection.createdAtMs,
      text,
    });
  }
  items.sort((a, b) => a.createdAtMs - b.createdAtMs);
  return items;
}

function buildImportLocalId(params: { kind: 'history' | 'sidechain'; remoteSessionId: string; messageId: string; sidechainId?: string }): string {
  const sidechainPart = params.kind === 'sidechain' && typeof params.sidechainId === 'string' && params.sidechainId ? `:${params.sidechainId}` : '';
  return `opencode:import:${params.kind}:${params.remoteSessionId}${sidechainPart}:${params.messageId}`;
}

export async function importOpenCodeTextHistoryCommitted(params: Readonly<{
  session: ApiSessionClient;
  provider: ACPProvider;
  remoteSessionId: string;
  items: ReadonlyArray<OpenCodeTextHistoryItem>;
  importedFrom: 'acp-history' | 'acp-sidechain';
  sidechainId?: string;
}>): Promise<void> {
  for (const item of params.items) {
    const localId = buildImportLocalId({
      kind: params.importedFrom === 'acp-sidechain' ? 'sidechain' : 'history',
      remoteSessionId: params.remoteSessionId,
      sidechainId: params.sidechainId,
      messageId: item.messageId,
    });
    const meta: Record<string, unknown> = {
      // Prevent imported user messages from being delivered into the agent queue.
      source: 'cli',
      sentFrom: 'cli',
      importedFrom: params.importedFrom,
      remoteSessionId: params.remoteSessionId,
      ...(params.importedFrom === 'acp-sidechain' && params.sidechainId ? { sidechainId: params.sidechainId } : {}),
    };

    if (item.role === 'user') {
      await params.session.sendUserTextMessageCommitted(item.text, { localId, meta });
      continue;
    }
    await params.session.sendAgentMessageCommitted(
      params.provider,
      { type: 'message', message: item.text, ...(params.sidechainId ? { sidechainId: params.sidechainId } : {}) },
      { localId, meta },
    );
  }
}
