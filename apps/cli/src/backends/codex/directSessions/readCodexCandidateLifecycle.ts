import { lstat } from 'node:fs/promises';

import { unknownCodexLifecycleV1, type CodexLifecycleV1 } from '@happier-dev/protocol';

import { readJsonlFileForward } from '@/api/directSessions/filePaging/jsonlForwardReader';
import type { JsonlParsedLine } from '@/api/directSessions/filePaging/jsonlBackwardPager';
import { isSubagentRollout } from '../localControl/rolloutDiscovery';
import { mapCodexRolloutEventToActions } from '../localControl/rolloutMapper';

// 与原生 IncrementalRollout 冷读和现有 JSONL reader 的块大小相同；首行和尾段各有此预算。
const READ_BYTES = 64 * 1024;
const RUNNING_STALE_MS = 900_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function id(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try { return record(JSON.parse(value)); } catch { return null; }
}

function questionIds(payload: Record<string, unknown>): string[] | null {
  const questions = jsonRecord(payload.arguments)?.questions ?? payload.questions;
  if (!Array.isArray(questions) || !questions.length) return null;
  const ids = questions.map((question) => id(record(question)?.id));
  return ids.every((value): value is string => value !== null) && new Set(ids).size === ids.length ? ids : null;
}

/** 只消费完整主轮事件元数据；正文和工具输出内容不能决定完成、失败或等待。 */
function projectLifecycle(lines: readonly JsonlParsedLine[], remoteSessionId: string, checkedAtMs: number): CodexLifecycleV1 {
  const unknown = () => unknownCodexLifecycleV1(checkedAtMs);
  let turnId: string | null = null;
  let state: CodexLifecycleV1['state'] = 'unknown';
  let eventAtMs: number | null = null;
  let lastAtMs: number | null = null;
  let nextOffset: number | null = null;
  let terminal: 'completed' | 'failed' | 'cancelled' | null = null;
  let terminalAtMs: number | null = null;
  const pending = new Map<string, { kind: 'async' | 'input' | 'approval'; questionIds: string[] | null }>();
  const observedTurns = new Set<string>();

  for (const line of lines) {
    if (nextOffset !== null && nextOffset !== line.startOffsetBytes) {
      turnId = null; state = 'unknown'; pending.clear();
    }
    nextOffset = line.endOffsetBytes + 1;
    const envelope = record(line.value);
    const payload = record(envelope?.payload);
    if (!envelope || !payload) { turnId = null; state = 'unknown'; continue; }
    if (envelope.type === 'session_meta') {
      if (payload.id !== remoteSessionId || isSubagentRollout(payload)) return unknown();
      continue;
    }
    // 明确的子线程事件不属于主轮，不能结束或刷新父会话。
    const threadId = id(payload.thread_id) ?? id(payload.threadId);
    if ((threadId && threadId !== remoteSessionId) || id(envelope.sidechainId) || id(payload.sidechainId)
      || id(envelope.sidechain_id) || id(payload.sidechain_id)) continue;
    const type = payload.type;
    const eventTurnId = id(payload.turn_id) ?? id(payload.turnId);
    const isEvent = envelope.type === 'event_msg';
    const isResponse = envelope.type === 'response_item';
    if (envelope.type === 'turn_context' && eventTurnId && eventTurnId !== turnId) {
      turnId = null; state = 'unknown'; pending.clear();
      continue;
    }
    const start = isEvent && (type === 'task_started' || type === 'turn_started');
    if (!start && !turnId) continue;
    if (!start && eventTurnId && eventTurnId !== turnId) {
      if (observedTurns.has(eventTurnId)) continue;
      turnId = null; state = 'unknown'; pending.clear();
      continue;
    }

    // 共享正文投影的正式轮次映射；别名只归一化字段，不从文字提取状态。
    const normalizedType = type === 'turn_started' ? 'task_started'
      : type === 'task_cancelled' || type === 'turn_cancelled' ? 'turn_aborted' : type;
    const boundary = isEvent && ['task_started', 'task_complete', 'turn_complete', 'turn_aborted'].includes(String(normalizedType))
      ? mapCodexRolloutEventToActions({ ...envelope, payload: { ...payload, type: normalizedType } }, { debug: false })
        .find((action) => action.type === 'turn-lifecycle') : undefined;
    const failed = isEvent && (type === 'task_failed' || type === 'turn_failed');
    const request = isEvent && ['request_user_input', 'user_input_requested', 'exec_approval_request', 'apply_patch_approval_request'].includes(String(type));
    const toolName = typeof payload.name === 'string' ? payload.name.split('__').at(-1) : null;
    const question = isResponse && (type === 'function_call' || type === 'custom_tool_call')
      && (toolName === 'request_user_input' || toolName === 'request_user_input_async');
    const callId = isResponse ? id(payload.call_id) : id(payload.call_id) ?? id(payload.request_id) ?? id(payload.id);
    const output = isResponse && (type === 'function_call_output' || type === 'custom_tool_call_output');
    // 异步工具立即返回的同callId结果仅确认注册，并不是用户回答。
    if (output && callId && pending.get(callId)?.kind === 'async') continue;
    const resolved = isEvent && (type === 'user_input' || type === 'approval_resolved');
    const user = (isResponse && type === 'message' && payload.role === 'user')
      || (isEvent && (type === 'user_message' || (type === 'item_completed' && record(payload.item)?.type === 'UserMessage')));
    const active = isEvent && (type === 'agent_message' || type === 'agent_reasoning');
    if (!boundary && !failed && !request && !question && !resolved && !user && !active && !(output && callId && pending.has(callId))) continue;
    const at = typeof envelope.timestamp === 'string' ? Date.parse(envelope.timestamp) : NaN;
    if (!Number.isSafeInteger(at) || at < 0 || at > checkedAtMs || (lastAtMs !== null && at < lastAtMs)) return unknown();
    lastAtMs = at;

    if (start) {
      if (!eventTurnId) return unknown();
      turnId = eventTurnId; observedTurns.add(eventTurnId); terminal = null; terminalAtMs = null;
      pending.clear(); state = 'running'; eventAtMs = at;
    } else if (boundary || failed) {
      if (!eventTurnId) return unknown();
      terminal = failed ? 'failed' : normalizedType === 'turn_aborted' ? 'cancelled' : 'completed';
      terminalAtMs = at;
      if (terminal !== 'completed') pending.clear();
      state = pending.size ? 'needs_input' : terminal; eventAtMs = at;
    } else if (request || question) {
      if (terminal) return unknown();
      // 无标识请求仍可显示等待；后续无法匹配的工具结果绝不能把它清掉。
      pending.set(callId ?? '', { kind: toolName === 'request_user_input_async' ? 'async'
        : type === 'exec_approval_request' || type === 'apply_patch_approval_request' ? 'approval' : 'input', questionIds: questionIds(payload) });
      state = 'needs_input'; eventAtMs = at;
    } else if (user) {
      // 用户形状的记录也可能是注入通知；不能从其正文猜测回答了哪个问题。
      if (terminal || pending.size) { turnId = null; state = 'unknown'; pending.clear(); }
    } else if (resolved || output) {
      const pendingRequest = callId ? pending.get(callId) : null;
      if (resolved && (!pendingRequest || (type === 'approval_resolved') !== (pendingRequest.kind === 'approval'))) return unknown();
      if (output) {
        const result = jsonRecord(payload.output);
        const answers = record(result?.answers);
        // 与原生 ToolRequestUserInputResponse / buildCodexRequestUserInputAnswers 的形状一致。
        // 错误、空答案、部分答案和自然语言回包都不能证明整组问题已解决。
        if (payload.is_error === true || payload.isError === true || result?.error != null
          || pendingRequest?.kind !== 'input' || !pendingRequest.questionIds || !answers
          || !pendingRequest.questionIds.every((questionId) => {
            const values = record(answers[questionId])?.answers;
            return Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === 'string' && value.trim().length > 0);
          })) return unknown();
      }
      if (!callId || !pending.delete(callId)) return unknown();
      state = pending.size ? 'needs_input' : terminal ?? 'running';
      eventAtMs = !pending.size && terminal ? terminalAtMs : at;
    } else if (active && !terminal && !pending.size) {
      state = 'running'; eventAtMs = at;
    }
  }
  if (!turnId || eventAtMs === null || state === 'unknown'
    || (state === 'running' && checkedAtMs - eventAtMs > RUNNING_STALE_MS)) return unknown();
  return { v: 1, state, eventAtMs, checkedAtMs };
}

/** 一次候选读取最多两个64KiB窗口；改写、未闭合尾行和证据缺口显式覆盖旧状态。 */
export async function readCodexCandidateLifecycle(params: Readonly<{
  filePath: string;
  remoteSessionId: string;
  checkedAtMs?: number;
}>): Promise<CodexLifecycleV1> {
  const checkedAtMs = params.checkedAtMs ?? Date.now();
  const unknown = () => unknownCodexLifecycleV1(checkedAtMs);
  try {
    const before = await lstat(params.filePath);
    if (!before.isFile()) return unknown();
    const options = { filePath: params.filePath, maxBytes: READ_BYTES, maxOversizeLineBytes: READ_BYTES, strictRead: true };
    const head = await readJsonlFileForward({ ...options, offsetBytes: 0, maxItems: 1 });
    const first = head.items[0];
    const metaEnvelope = record(first?.value);
    const meta = record(metaEnvelope?.payload);
    if (!first || first.startOffsetBytes !== 0 || metaEnvelope?.type !== 'session_meta'
      || meta?.id !== params.remoteSessionId || isSubagentRollout(meta)) return unknown();
    const offsetBytes = Math.max(0, before.size - READ_BYTES);
    const tail = await readJsonlFileForward({ ...options, offsetBytes, maxItems: READ_BYTES });
    const after = await lstat(params.filePath);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || tail.truncated || !tail.reachedEnd || tail.nextOffsetBytes !== before.size
      || tail.items.at(-1)?.endOffsetBytes !== before.size - 1) return unknown();
    // 从任意字节起读时，首段可能是被截断但偶然能解析的 JSON，不能当完整事件。
    const lines = offsetBytes ? tail.items.filter((line) => line.startOffsetBytes > offsetBytes) : tail.items;
    return projectLifecycle(lines, params.remoteSessionId, checkedAtMs);
  } catch { return unknown(); }
}
