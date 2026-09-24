import {
  boundSessionWorkStateItemsV1,
  normalizeOpenCodeSessionTodosToWorkStateItems,
  type SessionWorkStateItemV1,
  type SessionWorkStateV1,
} from '@happier-dev/protocol';

export const OPEN_CODE_TODO_WORK_STATE_OWNED_SOURCE_FAMILIES = ['todo:opencode'] as const;
export const OPEN_CODE_TODO_WORK_STATE_ITEM_LIMIT = 100;

function choosePrimaryTodoItem(items: readonly SessionWorkStateItemV1[]): string | null {
  return (
    items.find((item) => item.status === 'active')?.id
    ?? items.find((item) => item.status === 'pending' && item.priority === 'high')?.id
    ?? items.find((item) => item.status === 'pending')?.id
    ?? null
  );
}

export function buildOpenCodeTodoWorkState(params: Readonly<{
  backendId: string;
  agentId?: string;
  updatedAt: number;
  todos: unknown;
  maxItems?: number | null;
}>): SessionWorkStateV1 {
  const normalizedItems = normalizeOpenCodeSessionTodosToWorkStateItems({
    backendId: params.backendId,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    updatedAt: params.updatedAt,
    todos: params.todos,
  });
  const bounded = boundSessionWorkStateItemsV1({
    items: normalizedItems,
    maxItems: params.maxItems ?? OPEN_CODE_TODO_WORK_STATE_ITEM_LIMIT,
  });

  return {
    v: 1,
    backendId: params.backendId,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    updatedAt: params.updatedAt,
    items: bounded.items,
    primaryItemId: choosePrimaryTodoItem(bounded.items),
    ...(bounded.truncated ? { truncated: bounded.truncated } : {}),
  };
}
