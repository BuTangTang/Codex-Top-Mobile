function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSidechainId(value: unknown): string | null {
  return trimString(value);
}

function extractTextFromContentBlocks(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record?.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text);
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function extractAcpAssistantText(data: Record<string, unknown>): string | null {
  if (data.type !== 'message') return null;
  return typeof data.message === 'string' ? data.message : null;
}

function extractCodexAssistantText(data: Record<string, unknown>): string | null {
  if ((data.type === 'message' || data.type === 'agent_message') && typeof data.message === 'string') {
    return data.message;
  }
  return null;
}

function extractClaudeAssistantText(data: Record<string, unknown>): string | null {
  if (data.type !== 'assistant') return null;
  if (trimString(data.parent_tool_use_id)) return null;
  const message = asRecord(data.message);
  return extractTextFromContentBlocks(message?.content);
}

export function extractTurnAssistantTextFromSessionContent(content: unknown): Readonly<{
  text: string;
  provider: string | null;
  sidechainId: string | null;
}> | null {
  const record = asRecord(content);
  if (!record) return null;
  if (record.role !== 'agent') return null;

  const body = asRecord(record.content);
  if (!body) return null;

  if (body.type === 'text') {
    const text = typeof body.text === 'string' ? body.text : null;
    if (text === null) return null;
    return {
      text,
      provider: null,
      sidechainId: readSidechainId(record.sidechainId),
    };
  }

  if (body.type === 'acp') {
    const data = asRecord(body.data);
    if (!data) return null;
    const text = extractAcpAssistantText(data);
    if (text === null) return null;
    return {
      text,
      provider: trimString(body.provider),
      sidechainId: readSidechainId(data.sidechainId),
    };
  }

  if (body.type === 'codex') {
    const data = asRecord(body.data);
    if (!data) return null;
    const text = extractCodexAssistantText(data);
    if (text === null) return null;
    return {
      text,
      provider: 'codex',
      sidechainId: readSidechainId(data.sidechainId),
    };
  }

  if (body.type === 'output') {
    const data = asRecord(body.data);
    if (!data) return null;
    const text = extractClaudeAssistantText(data);
    if (text === null) return null;
    return {
      text,
      provider: 'claude',
      sidechainId: readSidechainId(data.sidechainId),
    };
  }

  return null;
}
