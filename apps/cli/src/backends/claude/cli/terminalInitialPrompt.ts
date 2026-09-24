import {
  claudeCliFlagHasOptionalValue,
  claudeCliFlagHasRequiredValue,
} from './flagArity';

export type ClaudeTerminalInitialPromptExtraction = Readonly<{
  prompt: string | null;
  claudeArgs: string[];
}>;

const promptFlagsWithValue = new Set(['-p', '--print']);

function readValue(args: readonly string[], index: number): string | null {
  const value = args[index + 1];
  return typeof value === 'string' ? value : null;
}

function appendPromptPart(parts: string[], value: string | null): void {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed) parts.push(trimmed);
}

export function extractClaudeTerminalInitialPrompt(
  claudeArgs: readonly string[] | null | undefined,
): ClaudeTerminalInitialPromptExtraction {
  const passthroughArgs: string[] = [];
  const promptParts: string[] = [];
  const args = claudeArgs ?? [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== 'string') continue;

    if (arg === '--') {
      appendPromptPart(promptParts, args.slice(index + 1).join(' '));
      break;
    }

    if (promptFlagsWithValue.has(arg)) {
      const value = readValue(args, index);
      if (value && !value.startsWith('-')) {
        appendPromptPart(promptParts, value);
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('--print=') || arg.startsWith('-p=')) {
      appendPromptPart(promptParts, arg.slice(arg.indexOf('=') + 1));
      continue;
    }

    if (arg.startsWith('-')) {
      passthroughArgs.push(arg);

      if (claudeCliFlagHasOptionalValue(arg)) {
        const value = readValue(args, index);
        if (value && !value.startsWith('-')) {
          passthroughArgs.push(value);
          index += 1;
        }
        continue;
      }

      if (claudeCliFlagHasRequiredValue(arg)) {
        const value = readValue(args, index);
        if (value) {
          passthroughArgs.push(value);
          index += 1;
        }
      }
      continue;
    }

    appendPromptPart(promptParts, arg);
  }

  return {
    prompt: promptParts.length > 0 ? promptParts.join(' ') : null,
    claudeArgs: passthroughArgs,
  };
}
