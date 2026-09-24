import {
  normalizeCursorModelVariantBaseId,
  normalizeToken,
  parseParameterizedModelValue,
} from './cursorModelConfigParsing';

export function pickCursorReasoningParamKey(modelBase: string, params: ReadonlyMap<string, string>): string {
  if (params.has('reasoning')) return 'reasoning';
  if (params.has('effort')) return 'effort';
  return modelBase.includes('claude') ? 'effort' : 'reasoning';
}

export function toDisplayModelId(modelValue: string): string {
  const parsed = parseParameterizedModelValue(modelValue);
  const base = normalizeCursorModelVariantBaseId(parsed.base);
  return base === 'default' ? 'default' : base;
}

export function formatModelOptionValueLabel(paramValue: string): string {
  const normalized = normalizeToken(paramValue);
  switch (normalized) {
    case 'true':
      return 'On';
    case 'false':
      return 'Off';
    case 'xhigh':
    case 'extra-high':
      return 'XHigh';
    case '1m':
    case '272k':
    case '300k':
    case '200k':
      return paramValue.toUpperCase();
    default:
      return paramValue
        .split(/[\s_-]+/u)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

export function formatModelOptionChoiceLabel(controlId: string, paramValue: string): string {
  if (normalizeToken(controlId) === 'fast') {
    const normalizedValue = normalizeToken(paramValue);
    if (normalizedValue === 'true') return 'Fast';
    if (normalizedValue === 'false') return 'Off';
  }

  return formatModelOptionValueLabel(paramValue);
}

export function modelParamControlId(paramKey: string): string | null {
  const normalized = normalizeToken(paramKey);
  if (
    normalized === 'reasoning' ||
    normalized === 'effort' ||
    normalized === 'reasoning-effort' ||
    normalized === 'thought-level'
  ) return 'reasoning_effort';
  if (normalized === 'context' || normalized === 'context-size' || normalized === 'context-window') return 'context';
  if (normalized === 'fast') return 'fast';
  if (normalized === 'thinking') return 'thinking';
  return null;
}

export function modelConfigOptionControlId(option: Readonly<{
  id?: string;
  name?: string;
  category?: string;
}>): string | null {
  return modelParamControlId(option.id ?? '')
    ?? modelParamControlId(option.category ?? '')
    ?? modelParamControlId(option.name ?? '');
}

export function modelParamControlName(controlId: string): string {
  switch (controlId) {
    case 'reasoning_effort':
      return 'Reasoning effort';
    case 'context':
      return 'Context';
    case 'thinking':
      return 'Thinking';
    case 'fast':
      return 'Fast';
    default:
      return controlId;
  }
}

export function modelParamControlType(controlId: string, values: ReadonlyArray<string>): string {
  if (controlId === 'thinking'
    && values.every((value) => normalizeToken(value) === 'true' || normalizeToken(value) === 'false')) {
    return 'boolean';
  }
  return 'select';
}

export function sortModelParamControlIds(left: string, right: string): number {
  const order = ['context', 'reasoning_effort', 'thinking', 'fast'];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex)
    || left.localeCompare(right);
}

export function sortModelParamValues(controlId: string, left: string, right: string): number {
  if (controlId === 'fast' || controlId === 'thinking') {
    const order = ['false', 'true'];
    return order.indexOf(normalizeToken(left)) - order.indexOf(normalizeToken(right));
  }

  if (controlId === 'reasoning_effort') {
    const order = ['none', 'low', 'medium', 'high', 'extra-high', 'xhigh', 'max'];
    const leftIndex = order.indexOf(normalizeToken(left));
    const rightIndex = order.indexOf(normalizeToken(right));
    return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex)
      || left.localeCompare(right);
  }

  if (controlId === 'context') {
    const order = ['200k', '272k', '300k', '1m'];
    const leftIndex = order.indexOf(normalizeToken(left));
    const rightIndex = order.indexOf(normalizeToken(right));
    return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex)
      || left.localeCompare(right);
  }

  return left.localeCompare(right);
}
