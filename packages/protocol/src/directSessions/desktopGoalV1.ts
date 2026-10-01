import { z } from 'zod';

/** 原桌面 threadGoal 状态。stalled 只是 blocked 的界面文案，不是协议状态。 */
export const DesktopGoalStatusV1Schema = z.enum([
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete',
]);
export type DesktopGoalStatusV1 = z.infer<typeof DesktopGoalStatusV1Schema>;

/** 只接受安全整数。缺用量用 null，禁止把缺失收成 0。 */
const safeNonNegativeInteger = z.number().refine(
  (value): value is number => Number.isSafeInteger(value) && value >= 0,
);

/**
 * 只读三态。unknown 是快照无法判断；none 是桌面明确没有目标；
 * available 只保留原目标字段。预算 null 不能当作比例，用量 null 是未知。
 */
export const DesktopGoalV1Schema = z.discriminatedUnion('availability', [
  z.object({ availability: z.literal('unknown') }).strict(),
  z.object({
    availability: z.literal('none'),
    source: z.literal('desktop'),
  }).strict(),
  z.object({
    availability: z.literal('available'),
    source: z.literal('desktop'),
    threadId: z.string().min(1),
    objective: z.string().min(1),
    status: DesktopGoalStatusV1Schema,
    tokenBudget: safeNonNegativeInteger.nullable(),
    tokensUsed: safeNonNegativeInteger.nullable(),
    timeUsedSeconds: safeNonNegativeInteger.nullable(),
    updatedAt: safeNonNegativeInteger,
  }).strict(),
]);
export type DesktopGoalV1 = z.infer<typeof DesktopGoalV1Schema>;
