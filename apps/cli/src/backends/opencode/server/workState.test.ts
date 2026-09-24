import { describe, expect, it } from 'vitest';

import { mergeSessionWorkStateMetadataV1 } from '@/session/workState/sessionWorkStateMetadata';

describe('OpenCode work state normalization', () => {
  it('maps native todos to generic todo items and chooses the active item as primary', async () => {
    const mod = await import('./workState').catch(() => null);
    expect(mod?.buildOpenCodeTodoWorkState).toEqual(expect.any(Function));

    const snapshot = mod!.buildOpenCodeTodoWorkState({
      backendId: 'opencode',
      updatedAt: 100,
      todos: [
        { content: 'Pending later', status: 'pending', priority: 'medium' },
        { content: 'Doing now', status: 'in_progress', priority: 'high' },
        { content: 'Done', status: 'completed', priority: 'low' },
      ],
    });

    expect(snapshot.primaryItemId).toBe(snapshot.items[1].id);
    expect(snapshot.items.map((item: any) => item.status)).toEqual(['pending', 'active', 'complete']);
    expect(snapshot.items.every((item: any) => item.kind === 'todo')).toBe(true);
  });

  it('bounds native todo snapshots and marks omitted items as truncated', async () => {
    const mod = await import('./workState');

    const snapshot = mod.buildOpenCodeTodoWorkState({
      backendId: 'opencode',
      updatedAt: 100,
      maxItems: 2,
      todos: [
        { id: 'todo_1', content: 'First', status: 'pending' },
        { id: 'todo_2', content: 'Second', status: 'in_progress' },
        { id: 'todo_3', content: 'Third', status: 'pending' },
      ],
    });

    expect(snapshot.items.map((item: any) => item.title)).toEqual(['First', 'Second']);
    expect(snapshot.truncated).toEqual({
      reason: 'item_limit',
      omittedCount: 1,
    });
    expect(snapshot.primaryItemId).toBe(snapshot.items[1].id);
  });

  it('scopes owned todo merges to OpenCode items', async () => {
    const mod = await import('./workState');
    expect(mod.OPEN_CODE_TODO_WORK_STATE_OWNED_SOURCE_FAMILIES).toEqual(['todo:opencode']);

    const snapshot = mod.buildOpenCodeTodoWorkState({
      backendId: 'opencode',
      updatedAt: 100,
      todos: [{ id: 'new', content: 'New OpenCode todo', status: 'pending' }],
    });

    const next = mergeSessionWorkStateMetadataV1({
      metadata: {
        sessionWorkStateV1: {
          v: 1,
          backendId: 'opencode',
          updatedAt: 50,
          items: [
            { id: 'todo:opencode:old', kind: 'todo', origin: 'vendor', backendId: 'opencode', status: 'pending', title: 'Old OpenCode todo', updatedAt: 50 },
            { id: 'todo:claude:keep', kind: 'todo', origin: 'vendor', backendId: 'claude', status: 'active', title: 'Claude todo', updatedAt: 50 },
          ],
        },
      },
      nextOwned: snapshot,
      ownedSourceFamilies: mod.OPEN_CODE_TODO_WORK_STATE_OWNED_SOURCE_FAMILIES,
    });

    expect(next.sessionWorkStateV1.items.map((item) => item.id)).toEqual([
      'todo:claude:keep',
      'todo:opencode:new',
    ]);
  });
});
