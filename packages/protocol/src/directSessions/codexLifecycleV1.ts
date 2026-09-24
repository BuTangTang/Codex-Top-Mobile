import { z } from 'zod';

/** 候选列表的显示事实；不包含控制请求 ID，不授予输入或审批能力。 */
export const CodexLifecycleV1Schema = z.object({
  v: z.literal(1),
  state: z.enum(['running', 'needs_input', 'completed', 'failed', 'cancelled', 'unknown']),
  eventAtMs: z.number().int().nonnegative().nullable(),
  checkedAtMs: z.number().int().nonnegative(),
}).strict().refine((value) => value.state === 'unknown'
  ? value.eventAtMs === null
  : value.eventAtMs !== null && value.eventAtMs <= value.checkedAtMs,
{ message: 'Known lifecycle requires an event timestamp at or before the check; unknown has no event timestamp' });

export type CodexLifecycleV1 = z.infer<typeof CodexLifecycleV1Schema>;

export function unknownCodexLifecycleV1(checkedAtMs: number): CodexLifecycleV1 {
  return { v: 1, state: 'unknown', eventAtMs: null, checkedAtMs };
}
