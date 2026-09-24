export interface CompactCommandResult {
  isCompact: boolean;
  originalMessage: string;
}

export interface ClearCommandResult {
  isClear: boolean;
}

export type SpecialCommandType = 'compact' | 'clear';

export interface SpecialCommandResult {
  type: SpecialCommandType | null;
  originalMessage?: string;
}

const DEFAULT_NON_STEERABLE_SPECIAL_COMMAND_TYPES: readonly SpecialCommandType[] = [
  'clear',
  'compact',
];

export function parseCompact(message: string): CompactCommandResult {
  const trimmed = message.trim();

  if (/^\/compact(?:\s|$)/u.test(trimmed)) {
    return {
      isCompact: true,
      originalMessage: trimmed,
    };
  }

  return {
    isCompact: false,
    originalMessage: message,
  };
}

export function parseClear(message: string): ClearCommandResult {
  const trimmed = message.trim();

  return {
    isClear: trimmed === '/clear',
  };
}

export function parseSpecialCommand(message: string): SpecialCommandResult {
  const compactResult = parseCompact(message);
  if (compactResult.isCompact) {
    return {
      type: 'compact',
      originalMessage: compactResult.originalMessage,
    };
  }

  const clearResult = parseClear(message);
  if (clearResult.isClear) {
    return {
      type: 'clear',
    };
  }

  return {
    type: null,
  };
}

export function isNonSteerableSpecialCommandType(
  type: SpecialCommandType | null,
): boolean {
  if (type === null) {
    return false;
  }
  return DEFAULT_NON_STEERABLE_SPECIAL_COMMAND_TYPES.includes(type);
}

export function isNonSteerablePromptPayload(
  message: string,
): boolean {
  return isNonSteerableSpecialCommandType(parseSpecialCommand(message).type);
}
