import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lstat, open } from 'node:fs/promises';

import { unknownCodexLifecycleV1, type CodexLifecycleV1 } from '@happier-dev/protocol';

import { tryParseJsonlLine } from '@/api/directSessions/filePaging/jsonlParse';
import type { JsonlParsedLine } from '@/api/directSessions/filePaging/jsonlBackwardPager';
import { isSubagentRollout } from '../localControl/rolloutDiscovery';
import { mapCodexRolloutEventToActions } from '../localControl/rolloutMapper';

// 与原生 IncrementalRollout 冷读和现有 JSONL reader 的块大小相同；首行和尾段各有此预算。
const READ_BYTES = 64 * 1024;
const RUNNING_STALE_MS = 900_000;
const CALL_READ_BYTES = 64 * 1024 * 1024;
const APPEND_READ_BYTES = 256 * 1024;
const RECOVERY_SPAN_BYTES = 32 * 1024 * 1024;
const FINGERPRINT_BYTES = 4096;
const CACHE_ENTRIES = 128;
const MAX_PENDING = 64;

type Projection = {
  terminalAnchorAllowed: boolean;
  unanchoredTurnId: string | null;
  turnId: string | null;
  state: CodexLifecycleV1['state'];
  eventAtMs: number | null;
  lastAtMs: number | null;
  nextOffset: number | null;
  terminal: 'completed' | 'failed' | 'cancelled' | null;
  terminalAtMs: number | null;
  terminalOffset: number | null;
  anchorOffset: number | null;
  pending: Map<string, { kind: 'async' | 'input' | 'approval'; questionIds: string[] | null }>;
  observedTurns: Set<string>;
  invalid: boolean;
};
type LifecycleCache = {
  source: Stats;
  headHash: string;
  tailHash: string;
  anchorHash: string;
  terminalHash: string;
  projection: Projection;
  mode: 'tracking' | 'search' | 'replay' | 'unavailable';
  cursor: number;
  searchEnd: number;
  searchFloor: number;
  skippingReverseLine: boolean;
};
const lifecycleCache = new Map<string, LifecycleCache>();
const inFlight = new Set<string>();

/** 创建或复制纯元数据投影；缓存不保存消息正文和工具输出。 */
function createProjection(previous?: Projection): Projection {
  return previous ? { ...previous, pending: new Map(previous.pending), observedTurns: new Set(previous.observedTurns) } : {
    terminalAnchorAllowed: true, unanchoredTurnId: null, turnId: null, state: 'unknown', eventAtMs: null,
    lastAtMs: null, nextOffset: null, terminal: null, terminalAtMs: null, terminalOffset: null, anchorOffset: null,
    pending: new Map(), observedTurns: new Set(), invalid: false,
  };
}

/** 将未知值收窄为普通记录。 */
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 保留显式非空标识；来源判定不能把超长子线程标识误作缺失。 */
function id(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** 解析工具协议中的结构化 JSON，失败时保持缺失。 */
function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try { return record(JSON.parse(value)); } catch { return null; }
}

/** 提取有界且无重复的问题标识，供准确匹配整组回答。 */
function questionIds(payload: Record<string, unknown>): string[] | null {
  const questions = jsonRecord(payload.arguments)?.questions ?? payload.questions;
  if (!Array.isArray(questions) || !questions.length || questions.length > 32) return null;
  const ids = questions.map((question) => id(record(question)?.id));
  return ids.every((value): value is string => value !== null && value.length <= 256) && new Set(ids).size === ids.length ? ids : null;
}

/** 只消费完整主轮事件元数据；正文和工具输出内容不能决定完成、失败或等待。 */
function projectLifecycle(lines: readonly JsonlParsedLine[], remoteSessionId: string, checkedAtMs: number, projection: Projection): CodexLifecycleV1 {
  /** 不可兼容的协议证据使本次投影失效，不能跨刷新保留旧状态。 */
  const unknown = () => { projection.invalid = true; return unknownCodexLifecycleV1(checkedAtMs); };
  let { terminalAnchorAllowed, unanchoredTurnId, turnId, state, eventAtMs, lastAtMs, nextOffset, terminal, terminalAtMs, terminalOffset, anchorOffset } = projection;
  const { pending, observedTurns } = projection;
  if (projection.invalid) return unknown();
  try {
    for (const line of lines) {
      if (nextOffset !== null && nextOffset !== line.startOffsetBytes) {
        turnId = null; state = 'unknown'; pending.clear(); terminalAnchorAllowed = false;
      }
      nextOffset = line.endOffsetBytes + 1;
      const envelope = record(line.value);
      const payload = record(envelope?.payload);
      if (!envelope || !payload) { turnId = null; state = 'unknown'; terminalAnchorAllowed = false; continue; }
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
      if (eventTurnId && eventTurnId.length > 512) return unknown();
      const isEvent = envelope.type === 'event_msg';
      const isResponse = envelope.type === 'response_item';
      // 原生附加的子活动记录可晚于所属旧轮完成；它不是主轮开始、完成或新的输入。
      if (isEvent && type === 'item_completed' && record(payload.item)?.type === 'SubAgentActivity') continue;
      if (envelope.type === 'turn_context' && (!eventTurnId || eventTurnId !== turnId)) {
        turnId = null; state = 'unknown'; pending.clear(); terminalAnchorAllowed = false;
        continue;
      }
      const start = isEvent && (type === 'task_started' || type === 'turn_started');
      // 窗口内的显式轮标识必须一致；活动正文不是运行证明，但其轮ID冲突不能被忽略。
      if (!start && !turnId && eventTurnId) {
        if (unanchoredTurnId && unanchoredTurnId !== eventTurnId) terminalAnchorAllowed = false;
        unanchoredTurnId = eventTurnId;
      }
      if (!start && turnId && eventTurnId && eventTurnId !== turnId) {
        if (observedTurns.has(eventTurnId)) continue;
        turnId = null; state = 'unknown'; pending.clear(); terminalAnchorAllowed = false;
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
      if ((request || question) && callId && callId.length > 512) return unknown();
      const output = isResponse && (type === 'function_call_output' || type === 'custom_tool_call_output');
      // 异步工具立即返回的同callId结果仅确认注册，并不是用户回答。
      if (output && callId && pending.get(callId)?.kind === 'async') continue;
      const resolved = isEvent && (type === 'user_input' || type === 'approval_resolved');
      const user = (isResponse && type === 'message' && payload.role === 'user')
        || (isEvent && (type === 'user_message' || (type === 'item_completed' && record(payload.item)?.type === 'UserMessage')));
      // 新版桌面的结构化主轮活动只刷新已锚定且同轮的运行，不解析正文，也不接受子活动或用户消息。
      const modernActive = isEvent && type === 'item_completed' && eventTurnId === turnId && turnId !== null
        && ['AgentMessage', 'Reasoning', 'CommandExecution', 'FileChange', 'McpToolCall', 'DynamicToolCall', 'WebSearch'].includes(String(record(payload.item)?.type));
      const active = isEvent && (type === 'agent_message' || type === 'agent_reasoning' || modernActive);
      const terminalWithoutStart = !turnId && Boolean(boundary || failed) && !start;
      if (terminalWithoutStart && !eventTurnId) return unknown();
      if (terminalWithoutStart && !terminalAnchorAllowed) {
        // 不可归属的前缀终态保持未知，但继续扫描，让后续明确开始的新轮建立自己的完整证据。
        state = 'unknown'; pending.clear();
        continue;
      }
      // 尚无轮锚时仍记录明确待处理请求；缺失开始事件不应把等待错误显示为完成。
      if (!start && !turnId && !terminalWithoutStart && !request && !question && !resolved && !output && !user) continue;
      if (!boundary && !failed && !request && !question && !resolved && !user && !active && !(output && callId && pending.has(callId))) continue;
      const at = typeof envelope.timestamp === 'string' ? Date.parse(envelope.timestamp) : NaN;
      if (!Number.isSafeInteger(at) || at < 0 || at > checkedAtMs || (lastAtMs !== null && at < lastAtMs)) return unknown();
      lastAtMs = at;

      if (start) {
        if (!eventTurnId) return unknown();
        turnId = eventTurnId; observedTurns.add(eventTurnId); anchorOffset = line.startOffsetBytes;
        if (observedTurns.size > MAX_PENDING) observedTurns.delete(observedTurns.values().next().value!);
        terminal = null; terminalAtMs = null; terminalOffset = null;
        pending.clear(); state = 'running'; eventAtMs = at;
      } else if (boundary || failed) {
        if (!eventTurnId) return unknown();
        if (terminalWithoutStart) { turnId = eventTurnId; observedTurns.add(eventTurnId); anchorOffset = line.startOffsetBytes; }
        terminal = failed ? 'failed' : normalizedType === 'turn_aborted' ? 'cancelled' : 'completed';
        terminalAtMs = at; terminalOffset = line.startOffsetBytes;
        if (terminal !== 'completed') pending.clear();
        state = pending.size ? 'needs_input' : terminal; eventAtMs = at;
      } else if (request || question) {
        if (terminal || pending.size >= MAX_PENDING) return unknown();
        // 无标识请求仍可显示等待；后续无法匹配的工具结果绝不能把它清掉。
        pending.set(callId ?? '', { kind: toolName === 'request_user_input_async' ? 'async'
          : type === 'exec_approval_request' || type === 'apply_patch_approval_request' ? 'approval' : 'input', questionIds: questionIds(payload) });
        state = 'needs_input'; eventAtMs = at;
      } else if (user) {
        // 原生同任务同轮接受输入是明确的继续事件，只解除普通输入等待，审批仍须匹配批准结果。
        const nativeContinuation = isEvent && type === 'item_completed' && threadId === remoteSessionId
          && turnId !== null && eventTurnId === turnId && !terminal;
        if (nativeContinuation) {
          for (const [pendingId, request] of pending) if (request.kind !== 'approval') pending.delete(pendingId);
          state = pending.size ? 'needs_input' : 'running'; eventAtMs = at;
        } else if (terminal || !turnId) {
          // 已结束轮不能被用户消息复活；普通追加输入保留当前轮锚和等待，不解析其正文。
          turnId = null; state = 'unknown'; pending.clear(); terminalAnchorAllowed = false;
        }
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
      || (state === 'running' && checkedAtMs - eventAtMs > RUNNING_STALE_MS)) return unknownCodexLifecycleV1(checkedAtMs);
    return { v: 1, state, eventAtMs, checkedAtMs };
  } finally {
    Object.assign(projection, { terminalAnchorAllowed, unanchoredTurnId, turnId, state, eventAtMs, lastAtMs, nextOffset, terminal, terminalAtMs, terminalOffset, anchorOffset });
  }
}

/** 对来源边界做摘要，缓存只保存散列而不是原始内容。 */
function fingerprint(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 所有读取共享同一硬预算；短读或超预算不能被当成已同步。 */
async function readRange(file: FileHandle, offset: number, length: number, budget: { remaining: number }): Promise<Buffer> {
  if (length < 0 || length > budget.remaining) throw new Error('Lifecycle read budget exhausted');
  budget.remaining -= length;
  const bytes = Buffer.alloc(length);
  if ((await file.read(bytes, 0, length, offset)).bytesRead !== length) throw new Error('Lifecycle source changed');
  return bytes;
}

/** 校验窗口内每条完整行；只允许调用方明确指定的首个截断片段被丢弃。 */
function parseWindow(bytes: Buffer, offset: number, skipFirst: boolean): { lines: JsonlParsedLine[]; nextOffset: number } {
  const lines: JsonlParsedLine[] = [];
  let start = skipFirst ? bytes.indexOf(0x0a) + 1 : 0;
  if (skipFirst && start === 0) return { lines, nextOffset: offset };
  for (let end = bytes.indexOf(0x0a, start); end >= 0; end = bytes.indexOf(0x0a, start)) {
    const value = tryParseJsonlLine(bytes.subarray(start, end));
    if (value === null) throw new Error('Invalid complete lifecycle line');
    lines.push({ value, startOffsetBytes: offset + start, endOffsetBytes: offset + end });
    start = end + 1;
  }
  return { lines, nextOffset: offset + start };
}

/** 最近的显式主轮开始即为边界；无效时间也必须重放验证，不能借用更早的开始。 */
function isMainStart(value: unknown, remoteSessionId: string): boolean {
  const envelope = record(value);
  const payload = record(envelope?.payload);
  const threadId = id(payload?.thread_id) ?? id(payload?.threadId);
  return envelope?.type === 'event_msg' && (payload?.type === 'task_started' || payload?.type === 'turn_started')
    && (!threadId || threadId === remoteSessionId) && !id(envelope.sidechainId) && !id(envelope.sidechain_id)
    && !id(payload.sidechainId) && !id(payload.sidechain_id);
}

/** 逆向只定位最近 32 MiB 内的开始；跨块长行不存正文，随后前向重放严格验证整条记录。 */
async function recoverAnchor(file: FileHandle, entry: LifecycleCache, remoteSessionId: string, budget: { remaining: number }): Promise<void> {
  // 保留最终来源边界校验的预算；搜索进度可在后续请求继续。
  while (entry.searchEnd > entry.searchFloor && budget.remaining >= READ_BYTES + 3 * FINGERPRINT_BYTES) {
    const length = Math.min(READ_BYTES, entry.searchEnd - entry.searchFloor);
    const base = entry.searchEnd - length;
    const bytes = await readRange(file, base, length, budget);
    let end = bytes.length;
    if (entry.skippingReverseLine) {
      const boundary = bytes.lastIndexOf(0x0a);
      if (boundary < 0) { entry.searchEnd = base; continue; }
      end = boundary + 1; entry.skippingReverseLine = false;
    }
    // 每次从完整行末尾倒读；首片段下次重读，避免把跨块开始事件漏掉。
    while (end > 0) {
      const newline = bytes.lastIndexOf(0x0a, end - 2);
      if (newline < 0 && base > 0) break;
      const start = newline + 1;
      const value = tryParseJsonlLine(bytes.subarray(start, end - 1));
      if (isMainStart(value, remoteSessionId)) {
        entry.mode = 'replay'; entry.cursor = base + start; entry.projection = createProjection();
        return;
      }
      end = start;
    }
    if (end === bytes.length) {
      // 整块属于一条长记录；只继续找其前方的边界，不从片段猜 JSON 字段。
      entry.searchEnd = base; entry.skippingReverseLine = true;
    } else entry.searchEnd = base + end;
    if (base === 0 && end === 0) break;
  }
  if (entry.searchEnd <= entry.searchFloor) entry.mode = 'unavailable';
}

/** 从完整行游标增量重放；读到预算边界的半行留到下次，未追到 EOF 绝不发布旧完成。 */
async function replay(file: FileHandle, entry: LifecycleCache, remoteSessionId: string, checkedAtMs: number, budget: { remaining: number }): Promise<void> {
  const available = Math.min(APPEND_READ_BYTES, budget.remaining - 3 * FINGERPRINT_BYTES, entry.source.size - entry.cursor);
  if (available <= 0) return;
  let length = available;
  const parts = [await readRange(file, entry.cursor, length, budget)];
  let hasNewline = parts[0]!.indexOf(0x0a) >= 0;
  // 首条记录跨块时只扫描新分片，最后拼接一次，避免长输出导致重复复制。
  while (!hasNewline && entry.cursor + length < entry.source.size && budget.remaining > 3 * FINGERPRINT_BYTES) {
    const count = Math.min(READ_BYTES, budget.remaining - 3 * FINGERPRINT_BYTES, entry.source.size - entry.cursor - length);
    const part = await readRange(file, entry.cursor + length, count, budget);
    parts.push(part); hasNewline = part.indexOf(0x0a) >= 0; length += count;
  }
  const bytes = parts.length === 1 ? parts[0]! : Buffer.concat(parts, length);
  const parsed = parseWindow(bytes, entry.cursor, false);
  projectLifecycle(parsed.lines, remoteSessionId, checkedAtMs, entry.projection);
  entry.cursor = parsed.nextOffset;
  if (entry.projection.invalid) throw new Error('Invalid lifecycle projection');
  if (entry.cursor === entry.source.size) entry.mode = 'tracking';
  // 剩余预算不足以闭合大行时保留完整行游标，下一次调用继续，不能永久判为不可用。
}

/** 读取首条来源及有界尾部，恢复或接续生命周期；两次追加尝试共同最多读取 64 MiB。 */
async function readLifecycle(params: Readonly<{ filePath: string; remoteSessionId: string; checkedAtMs: number }>, key: string): Promise<CodexLifecycleV1> {
  const budget = { remaining: CALL_READ_BYTES };
  let retrySource: Stats | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await lstat(params.filePath);
    if (!before.isFile() || (retrySource && (before.dev !== retrySource.dev || before.ino !== retrySource.ino || before.size < retrySource.size
      || (before.size === retrySource.size && (before.mtimeMs !== retrySource.mtimeMs || before.ctimeMs !== retrySource.ctimeMs))))) break;
    const file = await open(params.filePath, 'r');
    let entry: LifecycleCache;
    try {
      const opened = await file.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino) break;
      const head = await readRange(file, 0, Math.min(READ_BYTES, before.size), budget);
      const firstNewline = head.indexOf(0x0a);
      const first = firstNewline < 0 ? null : record(tryParseJsonlLine(head.subarray(0, firstNewline)));
      const meta = record(first?.payload);
      if (first?.type !== 'session_meta' || meta?.id !== params.remoteSessionId || isSubagentRollout(meta)) break;
      const cached = lifecycleCache.get(key);
      let validCache = cached && before.dev === cached.source.dev && before.ino === cached.source.ino && before.size >= cached.source.size
        && (before.size > cached.source.size || (before.mtimeMs === cached.source.mtimeMs && before.ctimeMs === cached.source.ctimeMs));
      if (cached?.mode === 'unavailable' && before.size > cached.source.size) validCache = false;
      if (validCache && cached) {
        const boundary = await readRange(file, Math.max(0, cached.source.size - FINGERPRINT_BYTES), Math.min(FINGERPRINT_BYTES, cached.source.size), budget);
        validCache = fingerprint(head.subarray(0, Math.min(FINGERPRINT_BYTES, cached.source.size))) === cached.headHash
          && fingerprint(boundary) === cached.tailHash;
        // 开始事件可能远离首尾窗口，另验其附近边界，防止改写旧轮并追加时沿用运行证据。
        if (validCache && cached.projection.anchorOffset !== null) {
          const offset = cached.projection.anchorOffset;
          validCache = fingerprint(await readRange(file, offset, Math.min(FINGERPRINT_BYTES, cached.source.size - offset), budget)) === cached.anchorHash;
        }
        // 终态可以位于首尾和开始锚之间；它是完成显示的直接证据，需要独立回读。
        if (validCache && cached.projection.terminalOffset !== null) {
          const offset = cached.projection.terminalOffset;
          validCache = fingerprint(await readRange(file, offset, Math.min(FINGERPRINT_BYTES, cached.source.size - offset), budget)) === cached.terminalHash;
        }
      }
      if (validCache && cached) {
        entry = { ...cached, source: before, projection: createProjection(cached.projection) };
      } else {
        const offset = Math.max(0, before.size - READ_BYTES);
        const tail = await readRange(file, offset, before.size - offset, budget);
        if (tail.at(-1) !== 0x0a) break;
        const parsed = parseWindow(tail, offset, offset > 0);
        const projection = createProjection();
        projectLifecycle(parsed.lines, params.remoteSessionId, params.checkedAtMs, projection);
        if (projection.invalid) break;
        entry = { source: before, headHash: '', tailHash: '', anchorHash: '', terminalHash: '', projection, mode: projection.turnId ? 'tracking' : 'search',
          cursor: before.size, searchEnd: parsed.lines[0]?.startOffsetBytes ?? offset,
          searchFloor: Math.max(0, before.size - RECOVERY_SPAN_BYTES), skippingReverseLine: false };
        if (entry.searchEnd === 0 && entry.mode === 'search') entry.mode = 'unavailable';
      }
      if (entry.mode === 'search') await recoverAnchor(file, entry, params.remoteSessionId, budget);
      // 正常含截图的长轮在同次调用内追平；不把每块读取量变成额外的手机刷新轮次。
      while ((entry.mode === 'replay' || entry.mode === 'tracking') && entry.cursor < before.size && budget.remaining > 3 * FINGERPRINT_BYTES) {
        const previousCursor = entry.cursor;
        await replay(file, entry, params.remoteSessionId, params.checkedAtMs, budget);
        if (entry.cursor === previousCursor) break;
      }
      entry.headHash = fingerprint(head.subarray(0, Math.min(FINGERPRINT_BYTES, before.size)));
      entry.tailHash = fingerprint(await readRange(file, Math.max(0, before.size - FINGERPRINT_BYTES), Math.min(FINGERPRINT_BYTES, before.size), budget));
      const anchor = entry.projection.anchorOffset;
      entry.anchorHash = anchor === null ? '' : fingerprint(await readRange(file, anchor, Math.min(FINGERPRINT_BYTES, before.size - anchor), budget));
      const terminal = entry.projection.terminalOffset;
      entry.terminalHash = terminal === null ? '' : fingerprint(await readRange(file, terminal, Math.min(FINGERPRINT_BYTES, before.size - terminal), budget));
    } finally { await file.close(); }
    const after = await lstat(params.filePath);
    if (before.dev !== after.dev || before.ino !== after.ino || !after.isFile() || after.size < before.size) break;
    if (after.size > before.size) {
      if (attempt === 0) { retrySource = after; continue; }
      break;
    }
    if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) break;
    lifecycleCache.delete(key);
    lifecycleCache.set(key, entry!);
    while (lifecycleCache.size > CACHE_ENTRIES) lifecycleCache.delete(lifecycleCache.keys().next().value!);
    if (entry!.mode !== 'tracking' || entry!.cursor !== before.size) return unknownCodexLifecycleV1(params.checkedAtMs);
    return projectLifecycle([], params.remoteSessionId, params.checkedAtMs, entry!.projection);
  }
  lifecycleCache.delete(key);
  return unknownCodexLifecycleV1(params.checkedAtMs);
}

/** 同一来源只允许一个读取提交缓存；并发调用明确未知，不能排队积压或返回陈旧状态。 */
export async function readCodexCandidateLifecycle(params: Readonly<{
  filePath: string;
  remoteSessionId: string;
  checkedAtMs?: number;
}>): Promise<CodexLifecycleV1> {
  const key = JSON.stringify([resolve(params.filePath), params.remoteSessionId]);
  const checkedAtMs = params.checkedAtMs ?? Date.now();
  if (inFlight.has(key) || inFlight.size >= CACHE_ENTRIES) return unknownCodexLifecycleV1(checkedAtMs);
  inFlight.add(key);
  try { return await readLifecycle({ ...params, checkedAtMs }, key); }
  catch { lifecycleCache.delete(key); return unknownCodexLifecycleV1(checkedAtMs); }
  finally { inFlight.delete(key); }
}
