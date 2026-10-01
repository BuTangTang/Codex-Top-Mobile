const DESKTOP_GOAL_STATUSES = [
  'active',
  'paused',
  'blocked',
  'usageLimited',
  'budgetLimited',
  'complete',
] as const;

type DesktopGoalStatus = typeof DESKTOP_GOAL_STATUSES[number];

export type DesktopGoalReadV1 =
  | Readonly<{ availability: 'unknown' }>
  | Readonly<{ availability: 'none'; source: 'desktop' }>
  | Readonly<{
    availability: 'available';
    source: 'desktop';
    threadId: string;
    objective: string;
    status: DesktopGoalStatus;
    tokenBudget: number | null;
    tokensUsed: number | null;
    timeUsedSeconds: number | null;
    updatedAt: number;
  }>;

const UNKNOWN: DesktopGoalReadV1 = { availability: 'unknown' };
const NONE: DesktopGoalReadV1 = { availability: 'none', source: 'desktop' };

/** 只接受普通对象，拒绝数组和空值伪装成会话快照。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 数量和秒必须是安全非负整数，不截断小数，也不把无穷收成有限值。 */
function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isStatus(value: unknown): value is DesktopGoalStatus {
  return typeof value === 'string' && (DESKTOP_GOAL_STATUSES as readonly string[]).includes(value);
}

/**
 * 缺失和 null 都保留为 null。已出现但类型不对返回 invalid，
 * 避免把坏字段悄悄当成未知用量或没有预算。
 */
function readNullableCount(record: Record<string, unknown>, key: string): number | null | 'invalid' {
  if (!Object.hasOwn(record, key) || record[key] === null) return null;
  return isSafeCount(record[key]) ? record[key] : 'invalid';
}

/**
 * 从原会话快照投影只读目标。不读文件、不写日志，也不把运行态、标题或轮次当成目标。
 * 快照缺少 threadGoal 是 unknown；显式 null 且身份匹配才是 none。
 */
export function readDesktopGoal(snapshot: unknown, expectedThreadId: string): DesktopGoalReadV1 {
  if (typeof expectedThreadId !== 'string' || expectedThreadId.length === 0
    || !isRecord(snapshot) || snapshot.id !== expectedThreadId || !Object.hasOwn(snapshot, 'threadGoal')) {
    return UNKNOWN;
  }
  const goal = snapshot.threadGoal;
  if (goal === null) return NONE;
  if (!isRecord(goal) || goal.threadId !== expectedThreadId
    || typeof goal.objective !== 'string' || goal.objective.trim().length === 0 || !isStatus(goal.status)) {
    return UNKNOWN;
  }
  const tokenBudget = readNullableCount(goal, 'tokenBudget');
  const tokensUsed = readNullableCount(goal, 'tokensUsed');
  const timeUsedSeconds = readNullableCount(goal, 'timeUsedSeconds');
  if (tokenBudget === 'invalid' || tokensUsed === 'invalid' || timeUsedSeconds === 'invalid'
    || !Object.hasOwn(goal, 'updatedAt') || !isSafeCount(goal.updatedAt)) {
    return UNKNOWN;
  }
  return {
    availability: 'available',
    source: 'desktop',
    threadId: expectedThreadId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget,
    tokensUsed,
    timeUsedSeconds,
    updatedAt: goal.updatedAt,
  };
}
