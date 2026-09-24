import { describe, expect, it } from 'vitest';

import { normalizeOpenCodeSessionTodosToWorkStateItems } from './sessionTodo.js';

describe('OpenCode session todo wire schema', () => {
    it('normalizes OpenCode todo statuses into generic work-state todo items', () => {
        const items = normalizeOpenCodeSessionTodosToWorkStateItems({
            backendId: 'opencode',
            updatedAt: 123,
            todos: [
                { content: 'Implement contracts', status: 'in_progress', priority: 'high' },
                { content: 'Remove provider status leak', status: 'completed', priority: 'medium' },
                { content: 'Unknown future item', status: 'deferred', priority: 'low' },
            ],
        });

        expect(items.map((item) => item.status)).toEqual(['active', 'complete', 'unknown']);
        expect(items[0]).toMatchObject({
            id: expect.stringMatching(/^todo:opencode:derived:/),
            kind: 'todo',
            origin: 'vendor',
            title: 'Implement contracts',
            priority: 'high',
            backendId: 'opencode',
            updatedAt: 123,
        });
        expect(items.some((item) => (item.status as string) === 'in_progress')).toBe(false);
        expect(items.some((item) => (item.status as string) === 'completed')).toBe(false);
    });

    it('scopes vendor todo ids to OpenCode so stale-item merges do not remove other provider todos', () => {
        const [item] = normalizeOpenCodeSessionTodosToWorkStateItems({
            backendId: 'opencode',
            updatedAt: 123,
            todos: [{ id: 'abc-123', content: 'Provider todo', status: 'pending' }],
        });

        expect(item?.id).toBe('todo:opencode:abc-123');
        expect(item?.vendorRef).toBe('abc-123');
    });
});
