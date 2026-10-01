import { describe, expect, it } from 'vitest';
import { readDesktopGoal } from './desktopGoal';

const threadId = 'thread-synthetic';
const statuses = ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const;

function snapshot(threadGoal?: unknown, id = threadId) {
  const value: Record<string, unknown> = {
    id,
    threadRuntimeStatus: { type: 'active' },
    turns: [{ turnId: 'turn-synthetic', status: 'inProgress', items: [] }],
    requests: [],
  };
  if (arguments.length > 0) value.threadGoal = threadGoal;
  return value;
}

function goal(status: typeof statuses[number], fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    threadId,
    objective: '完成接入',
    status,
    tokenBudget: 1000,
    tokensUsed: 250,
    timeUsedSeconds: 3,
    updatedAt: 120,
    ...fields,
  };
}

function without(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function read(value: unknown, expected = threadId) {
  return readDesktopGoal(value, expected);
}

describe('readDesktopGoal', () => {
  it('普通运行快照没有 threadGoal 时是 unknown，不能用运行态伪造目标', () => {
    expect(read(snapshot())).toEqual({ availability: 'unknown' });
  });

  it('显式 null 才是 none，且仍要求快照身份匹配', () => {
    expect(read(snapshot(null))).toEqual({ availability: 'none', source: 'desktop' });
    expect(read(snapshot(null, 'other-thread'))).toEqual({ availability: 'unknown' });
  });

  it.each(statuses)('投影匹配的 %s 目标并保留秒和整数原值', (status) => {
    expect(read(snapshot(goal(status)))).toEqual({
      availability: 'available',
      source: 'desktop',
      threadId,
      objective: '完成接入',
      status,
      tokenBudget: 1000,
      tokensUsed: 250,
      timeUsedSeconds: 3,
      updatedAt: 120,
    });
  });

  it('预算缺失或 null 不编造比例，用量缺失保持未知且不补 0', () => {
    expect(read(snapshot(goal('active', { tokenBudget: undefined })))).toEqual({ availability: 'unknown' });
    expect(read(snapshot(without(goal('active'), 'tokenBudget')))).toMatchObject({
      tokenBudget: null, tokensUsed: 250, timeUsedSeconds: 3,
    });
    expect(read(snapshot(goal('active', { tokenBudget: null, tokensUsed: null })))).toMatchObject({
      tokenBudget: null,
      tokensUsed: null,
      timeUsedSeconds: 3,
    });
    expect(read(snapshot(without(goal('paused'), 'tokensUsed', 'timeUsedSeconds')))).toMatchObject({
      tokensUsed: null,
      timeUsedSeconds: null,
      tokenBudget: 1000,
    });
    expect(read(snapshot(goal('active', { tokensUsed: 0, timeUsedSeconds: 0 })))).toMatchObject({
      tokensUsed: 0,
      timeUsedSeconds: 0,
    });
  });

  it('错 thread、坏类型、NaN、负数和未知状态都是 unknown', () => {
    expect(read(snapshot(goal('active')), 'other-thread')).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active', { threadId: 'other-thread' })))).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active', { objective: 1 })))).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active', { objective: '   ' })))).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active', { status: 'running' })))).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active', { status: 'stalled' })))).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active', { tokensUsed: Number.NaN })))).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active', { timeUsedSeconds: -1 })))).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active', { tokenBudget: 1.5 })))).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active', { updatedAt: '120' })))).toEqual({ availability: 'unknown' });
    expect(read(null)).toEqual({ availability: 'unknown' });
    expect(read([])).toEqual({ availability: 'unknown' });
    expect(read(snapshot(goal('active')), '')).toEqual({ availability: 'unknown' });
  });

  it('收窄未来字段，不要求 createdAt，也不传播 goalId 或运行态', () => {
    const result = read(snapshot({
      ...goal('budgetLimited'),
      goalId: 'synthetic-goal',
      createdAt: 10,
      progress: 0.5,
      note: 'future',
    }));
    expect(result).toEqual({
      availability: 'available',
      source: 'desktop',
      threadId,
      objective: '完成接入',
      status: 'budgetLimited',
      tokenBudget: 1000,
      tokensUsed: 250,
      timeUsedSeconds: 3,
      updatedAt: 120,
    });
    expect(result).not.toHaveProperty('goalId');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('progress');
    expect(result).not.toHaveProperty('threadRuntimeStatus');
  });
});
