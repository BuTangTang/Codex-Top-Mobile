import { describe, expect, it } from 'vitest';
import { DesktopGoalV1Schema } from './desktopGoalV1';

const statuses = ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const;

function available(status: typeof statuses[number], fields: Record<string, unknown> = {}) {
  return {
    availability: 'available',
    source: 'desktop',
    threadId: 'thread-synthetic',
    objective: '完成接入',
    status,
    tokenBudget: 1000,
    tokensUsed: 250,
    timeUsedSeconds: 3,
    updatedAt: 120,
    ...fields,
  };
}

describe('desktop goal read contract', () => {
  it.each(statuses)('保留原状态 %s，不把运行态收成目标', (status) => {
    expect(DesktopGoalV1Schema.parse(available(status))).toEqual(available(status));
  });

  it('无预算和未知用量用 null，真实 0 仍然是 0', () => {
    const goal = available('active', { tokenBudget: null, tokensUsed: null, timeUsedSeconds: 0 });
    expect(DesktopGoalV1Schema.parse(goal)).toEqual(goal);
    expect(DesktopGoalV1Schema.parse(available('active', { tokensUsed: 0, timeUsedSeconds: null }))).toMatchObject({
      tokensUsed: 0,
      timeUsedSeconds: null,
    });
  });

  it('none 只表示桌面明确没有目标，unknown 不携带来源或目标正文', () => {
    expect(DesktopGoalV1Schema.parse({ availability: 'none', source: 'desktop' })).toEqual({
      availability: 'none',
      source: 'desktop',
    });
    expect(DesktopGoalV1Schema.parse({ availability: 'unknown' })).toEqual({ availability: 'unknown' });
  });

  it('拒绝运行态、未知状态、比例、未来字段、坏数量和缺字段', () => {
    expect(DesktopGoalV1Schema.safeParse(available('active', { status: 'running' })).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse(available('active', { status: 'stalled' })).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse(available('active', { progress: 0.25 })).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse(available('active', { goalId: 'goal-1' })).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse(available('active', { createdAt: 10 })).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse(available('active', { tokenBudget: -1 })).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse(available('active', { tokensUsed: Number.NaN })).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse(available('active', { timeUsedSeconds: 1.5 })).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse(available('active', { updatedAt: Number.POSITIVE_INFINITY })).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse({ availability: 'available', source: 'desktop' }).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse({ availability: 'none' }).success).toBe(false);
    expect(DesktopGoalV1Schema.safeParse({ availability: 'unknown', source: 'desktop' }).success).toBe(false);
  });
});
