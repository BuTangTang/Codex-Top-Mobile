import type { DirectTranscriptRawMessageV1, DirectSessionObservationV1 } from '@happier-dev/protocol';

import type { CodexRolloutAction } from '../localControl/rolloutMapper';
import { projectCodexRolloutActions } from '../rollout/projectCodexRolloutActions';

function shouldFilterHarnessBlob(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // Known harness/system blobs embedded as user content (replay sessions, agent harness, etc).
  const patterns = [
    '# AGENTS.md instructions',
    '<environment_context>',
    '<turn_aborted>',
    '<INSTRUCTIONS>',
    'You are GPT-',
    'Codex CLI is an open source project',
  ];
  return patterns.some((p) => t.includes(p));
}

function extractEnvelopeTimestampMs(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const ts = typeof (value as any).timestamp === 'string' ? String((value as any).timestamp) : '';
  if (!ts.trim()) return 0;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) && ms >= 0 ? Math.trunc(ms) : 0;
}

function stableOffsetId(prefix: string, offset: number, actionIndex: number): string {
  const padded = Math.max(0, Math.trunc(offset)).toString().padStart(12, '0');
  const idx = Math.max(0, Math.trunc(actionIndex)).toString().padStart(3, '0');
  return `${prefix}:${padded}:${idx}`;
}

/** 将 rollout 动作转换为 direct 消息，以文件位置标识记录，以原生 clientId 关联发送回显。 */
export function mapCodexRolloutLineToDirectMessages(params: Readonly<{
  fileRelPath: string;
  lineStartOffsetBytes: number;
  lineValue: unknown;
  actions: ReadonlyArray<CodexRolloutAction>;
  sidechainId?: string | null;
}>): DirectTranscriptRawMessageV1[] {
  const createdAtMs = extractEnvelopeTimestampMs(params.lineValue);
  // Direct transcript rendering should include "debug-only" tool calls (e.g., Codex-internal read/write tools),
  // but must still filter harness/system blobs that Codex sometimes embeds as user messages.
  const projected = projectCodexRolloutActions(
    params.actions,
    { sidechainId: params.sidechainId ?? null },
  );

  const out: DirectTranscriptRawMessageV1[] = [];
  for (let i = 0; i < projected.length; i++) {
    const action = projected[i]!;
    const idPrefix = `codex:${params.fileRelPath}`;
    const stableId = stableOffsetId(idPrefix, params.lineStartOffsetBytes, i);

    if (action.type === 'user-text') {
      if (shouldFilterHarnessBlob(action.text)) continue;
      out.push({
        id: stableId,
        // 回显关联只使用明确的原生客户端 ID；缺失时沿用位置身份，不按正文猜配。
        localId: action.clientId ?? stableId,
        createdAtMs,
        raw: {
          role: 'user',
          content: { type: 'text', text: action.text },
        },
      });
      continue;
    }

    if (action.type === 'assistant-text') {
      out.push({
        id: stableId,
        localId: stableId,
        createdAtMs,
        raw: {
          role: 'agent',
          content: {
            type: 'codex',
            data: {
              type: 'message',
              message: action.text,
              ...(action.sidechainId ? { sidechainId: action.sidechainId } : {}),
            },
          },
        },
      });
      continue;
    }

    if (action.type === 'context-compaction') {
      if (action.sidechainId) continue;
      out.push({
        id: stableId,
        localId: stableId,
        createdAtMs,
        raw: {
          role: 'agent',
          content: {
            type: 'event',
            id: stableId,
            data: {
              type: 'context-compaction',
              phase: action.phase,
              lifecycleId: action.lifecycleId,
              provider: 'codex',
              source: action.source,
              ...(action.providerEventId ? { providerEventId: action.providerEventId } : {}),
            },
          },
        },
      });
      continue;
    }

    if (action.type === 'tool-call') {
      out.push({
        id: stableId,
        localId: stableId,
        createdAtMs,
        raw: {
          role: 'agent',
          content: {
            type: 'codex',
            data: {
              type: 'tool-call',
              callId: action.callId,
              name: action.name,
              input: action.input,
              id: stableId,
              ...(action.sidechainId ? { sidechainId: action.sidechainId } : {}),
            },
          },
        },
      });
      continue;
    }

    if (action.type === 'tool-result') {
      out.push({
        id: stableId,
        localId: stableId,
        createdAtMs,
        raw: {
          role: 'agent',
          content: {
            type: 'codex',
            data: {
              type: 'tool-call-result',
              callId: action.callId,
              output: action.output,
              id: stableId,
              ...(action.sidechainId ? { sidechainId: action.sidechainId } : {}),
              ...(action.isError ? { isError: action.isError } : {}),
            },
          },
        },
      });
      continue;
    }
  }

  // 生命周期在共享文字投影之前被明确解析；子任务不能结束主会话，也不用文本补完成。
  if (!params.sidechainId) for (const [index, action] of params.actions.entries()) {
    if (action.type !== 'turn-lifecycle') continue;
    const event = action.event;
    if (event.type !== 'turn_started' && event.type !== 'turn_terminal') continue;
    const state = event.type === 'turn_started' ? 'running'
      : event.reason === 'completed' ? 'completed' : event.reason === 'aborted' ? 'cancelled' : null;
    if (!state) continue;
    const observation: DirectSessionObservationV1 = event.providerTurnId
      ? { v: 1, source: 'rollout', state, turnId: event.providerTurnId }
      : { v: 1, state: 'unknown', reason: 'missing_turn_id' };
    const id = `${stableOffsetId(`codex:${params.fileRelPath}`, params.lineStartOffsetBytes, index)}:lifecycle`;
    out.push({ id, localId: id, createdAtMs, raw: {
      role: 'agent', directSessionObservationV1: observation,
      content: { type: 'event', data: { type: state === 'running' ? 'task_started' : state === 'completed' ? 'task_complete' : 'turn_aborted',
        ...(event.providerTurnId ? { turnId: event.providerTurnId } : {}) } },
    } });
  }
  return out;
}
