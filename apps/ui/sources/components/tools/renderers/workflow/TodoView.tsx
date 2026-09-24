import * as React from 'react';
import type { ToolViewProps } from '../core/_registry';
import { ToolSectionView } from '../../shell/presentation/ToolSectionView';
import { TodoChecklist } from '@/components/todos/TodoChecklist';


export interface Todo {
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    priority?: 'high' | 'medium' | 'low';
    id?: string;
}

export const TodoView = React.memo<ToolViewProps>(({ tool, detailLevel }) => {
    if (tool.state !== 'completed') return null;

    const listFromResult = Array.isArray((tool.result as any)?.todos) ? ((tool.result as any).todos as Todo[]) : null;
    const listFromLegacyResult = Array.isArray((tool.result as any)?.newTodos) ? ((tool.result as any).newTodos as Todo[]) : null;
    const listFromInput = Array.isArray((tool.input as any)?.todos) ? ((tool.input as any).todos as Todo[]) : null;

    const todosList = listFromResult ?? listFromLegacyResult ?? listFromInput ?? [];
    if (todosList.length === 0) return null;

    const isFullView = detailLevel === 'full';
    return (
        <ToolSectionView fullWidth={isFullView}>
            <TodoChecklist
                items={todosList.map((todo, index) => ({
                    id: todo.id ?? `todo-${index}`,
                    title: todo.content,
                    status: todo.status,
                }))}
                maxItems={isFullView ? 50 : 6}
                numberOfLines={isFullView ? 3 : 2}
                surface="inset"
            />
        </ToolSectionView>
    );
});
