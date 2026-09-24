export type PermissionModeQueuedPrompt = Readonly<{
  text: string;
  localId: string | null;
  meta?: Record<string, unknown>;
}>;

export function combinePermissionModeQueuedPrompts(
  prompts: readonly PermissionModeQueuedPrompt[],
): PermissionModeQueuedPrompt {
  const [first] = prompts;
  return {
    text: prompts.map((prompt) => prompt.text).join('\n'),
    localId: first?.localId ?? null,
    ...(first?.meta ? { meta: first.meta } : {}),
  };
}
