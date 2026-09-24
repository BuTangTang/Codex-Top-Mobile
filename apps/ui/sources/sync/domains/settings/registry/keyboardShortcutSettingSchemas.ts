import { z } from 'zod';

export const KeyboardShortcutRuleSchema = z.object({
    binding: z.string().trim().min(1),
    platforms: z.array(z.enum(['macos', 'ios', 'windows', 'linux', 'android', 'web'])).optional(),
    blockedSurfaces: z.array(z.enum(['native', 'web'])).optional(),
    allowInEditable: z.boolean().optional(),
});

export const KeyboardShortcutOverridesSchema = z.record(z.string().trim().min(1), z.array(z.unknown()))
    .transform((record) => Object.fromEntries(
        Object.entries(record)
            .map(([commandId, entries]) => [
                commandId,
                entries
                    .map((entry) => KeyboardShortcutRuleSchema.safeParse(entry))
                    .filter((entry): entry is z.ZodSafeParseSuccess<z.infer<typeof KeyboardShortcutRuleSchema>> => entry.success)
                    .map((entry) => entry.data),
            ] as const)
            .filter(([, entries]) => entries.length > 0),
    ))
    .catch({});

export const KeyboardShortcutDisabledCommandIdsSchema = z.array(z.unknown())
    .transform((ids) => ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))
    .catch([]);

export function countKeyboardShortcutOverrides(value: unknown): number {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
    return Object.keys(value as Record<string, unknown>).length;
}
