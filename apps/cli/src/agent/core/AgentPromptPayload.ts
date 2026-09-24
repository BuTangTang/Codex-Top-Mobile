import type { AgentBackend } from './AgentBackend';
import type { SessionId } from './AgentMessage';

export type AgentPromptPayload = Readonly<{
  text: string;
  displayText?: string;
  meta?: Record<string, unknown> | null;
}>;

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeStructuredInputEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  const imageInputs = Array.isArray(envelope.imageInputs) ? envelope.imageInputs : null;
  const attachments = Array.isArray(envelope.attachments) ? envelope.attachments : null;
  if (!imageInputs && !attachments) return envelope;
  return {
    ...envelope,
    ...(imageInputs && !attachments ? { attachments: imageInputs } : {}),
    ...(attachments && !imageInputs ? { imageInputs: attachments } : {}),
  };
}

export function normalizeAgentPromptPayload(payload: AgentPromptPayload): AgentPromptPayload {
  const meta = readRecord(payload.meta);
  const envelope = readRecord(meta?.happierStructuredInputV1);
  if (!meta || !envelope) return payload;

  const normalizedEnvelope = normalizeStructuredInputEnvelope(envelope);
  if (normalizedEnvelope === envelope) return payload;

  return {
    ...payload,
    meta: {
      ...meta,
      happierStructuredInputV1: normalizedEnvelope,
    },
  };
}

export async function sendAgentPromptPayload(
  backend: AgentBackend,
  sessionId: SessionId,
  payload: AgentPromptPayload,
): Promise<void> {
  const normalizedPayload = normalizeAgentPromptPayload(payload);
  if (typeof backend.sendPromptPayload === 'function') {
    await backend.sendPromptPayload(sessionId, normalizedPayload);
    return;
  }

  await backend.sendPrompt(sessionId, normalizedPayload.text);
}

export async function sendAgentSteerPromptPayload(
  backend: AgentBackend,
  sessionId: SessionId,
  payload: AgentPromptPayload,
): Promise<void> {
  const normalizedPayload = normalizeAgentPromptPayload(payload);
  if (typeof backend.sendSteerPromptPayload === 'function') {
    await backend.sendSteerPromptPayload(sessionId, normalizedPayload);
    return;
  }
  if (typeof backend.sendSteerPrompt !== 'function') {
    throw new Error('Backend does not support steering');
  }
  await backend.sendSteerPrompt(sessionId, normalizedPayload.text);
}
