import type { TranslatableText } from '@/agents/providers/shared/providerSettingsPlugin';
import { t } from '@/text';

export function resolveProviderSettingsText(input: TranslatableText | undefined): string | undefined {
    if (input === undefined) return undefined;
    if (typeof input === 'string') return input;
    return t(input.key);
}
