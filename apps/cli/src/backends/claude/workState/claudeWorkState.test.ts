import { describe, expect, it } from 'vitest';

describe('Claude work state normalization', () => {
  it('does not project background task lifecycle system messages to user-facing task items', async () => {
    const mod = await import('./claudeWorkState').catch(() => null);
    expect(mod?.buildClaudeTaskLifecycleWorkState).toEqual(expect.any(Function));

    const snapshot = mod!.buildClaudeTaskLifecycleWorkState({
      backendId: 'claude',
      updatedAt: 200,
      messages: [
        { type: 'system', subtype: 'task_started', task_id: 'task_1', description: 'grep -rn "thing"', task_type: 'local_bash' },
        { type: 'system', subtype: 'task_progress', task_id: 'task_1', description: 'Reading logs', task_type: 'local_bash' },
        { type: 'system', subtype: 'task_notification', task_id: 'task_1', status: 'completed', summary: 'Background command completed' },
      ],
    });

    expect(snapshot.items).toEqual([]);
    expect(snapshot.primaryItemId).toBeNull();
  });

  it('projects TodoWrite data to generic todo items', async () => {
    const mod = await import('./claudeWorkState').catch(() => null);
    expect(mod?.buildClaudeTodoWriteWorkState).toEqual(expect.any(Function));

    const snapshot = mod!.buildClaudeTodoWriteWorkState({
      backendId: 'claude',
      updatedAt: 300,
      input: {
        todos: [
          { content: 'Write test', status: 'in_progress', activeForm: 'Writing test' },
          { content: 'Refactor', status: 'pending' },
        ],
      },
    });

    expect(snapshot.primaryItemId).toBe(snapshot.items[0].id);
    expect(snapshot.items.map((item: any) => item.status)).toEqual(['active', 'pending']);
    expect(snapshot.items[0].title).toBe('Write test');
    expect(snapshot.items[0].summary).toBe('Writing test');
  });

  it('uses a Claude-owned TodoWrite source family without removing other provider todos', async () => {
    const mod = await import('./claudeWorkState');
    const { mergeSessionWorkStateMetadataV1 } = await import('@/session/workState/sessionWorkStateMetadata');

    const snapshot = mod.buildClaudeTodoWriteWorkState({
      backendId: 'claude',
      updatedAt: 300,
      input: {
        todos: [
          { content: 'Claude todo', status: 'pending' },
        ],
      },
    }) as any;

    const next = mergeSessionWorkStateMetadataV1({
      metadata: {
        sessionWorkStateV1: {
          v: 1,
          backendId: 'claude',
          updatedAt: 200,
          items: [
            { id: 'todo:opencode:keep', kind: 'todo', origin: 'vendor', backendId: 'opencode', status: 'active', title: 'OpenCode todo', updatedAt: 200 },
            { id: 'todo:derived:claude.todo:stale', kind: 'todo', origin: 'vendor', backendId: 'claude', status: 'pending', title: 'Stale Claude todo', updatedAt: 200 },
          ],
        },
      },
      nextOwned: snapshot,
      ownedSourceFamilies: snapshot.ownedSourceFamilies,
    });

    expect(next.sessionWorkStateV1.items.map((item: any) => item.id)).toEqual([
      'todo:opencode:keep',
      snapshot.items[0].id,
    ]);
  });

  it('uses a Claude-owned Task-tool source family without removing future provider tasks', async () => {
    const mod = await import('./claudeWorkState');
    const { mergeSessionWorkStateMetadataV1 } = await import('@/session/workState/sessionWorkStateMetadata');
    const tracker = mod.createClaudeTaskToolWorkStateTracker({
      backendId: 'claude',
      agentId: 'claude',
    });

    const snapshot = tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_create_1',
          name: 'TaskCreate',
          input: { subject: 'Claude task' },
        }],
      },
    }, 400) as any;

    const next = mergeSessionWorkStateMetadataV1({
      metadata: {
        sessionWorkStateV1: {
          v: 1,
          backendId: 'claude',
          updatedAt: 200,
          items: [
            { id: 'task:future-provider:keep', kind: 'task', origin: 'vendor', backendId: 'future-provider', status: 'active', title: 'Future task', updatedAt: 200 },
            { id: 'task:derived:claude.task:stale', kind: 'task', origin: 'vendor', backendId: 'claude', status: 'pending', title: 'Stale Claude task', updatedAt: 200 },
          ],
        },
      },
      nextOwned: snapshot,
      ownedSourceFamilies: snapshot.ownedSourceFamilies,
    });

    expect(next.sessionWorkStateV1.items.map((item: any) => item.id)).toEqual([
      'task:future-provider:keep',
      snapshot.items[0].id,
    ]);
  });

  it('bounds TodoWrite snapshots and marks omitted items as truncated', async () => {
    const mod = await import('./claudeWorkState');

    const snapshot = mod.buildClaudeTodoWriteWorkState({
      backendId: 'claude',
      updatedAt: 300,
      maxItems: 2,
      input: {
        todos: [
          { content: 'First', status: 'pending' },
          { content: 'Second', status: 'in_progress' },
          { content: 'Third', status: 'pending' },
        ],
      },
    });

    expect(snapshot.items.map((item: any) => item.title)).toEqual(['First', 'Second']);
    expect(snapshot.primaryItemId).toBe(snapshot.items[1].id);
    expect(snapshot.truncated).toEqual({
      reason: 'item_limit',
      omittedCount: 1,
    });
  });

  it('tracks Claude TaskCreate results and TaskUpdate tool uses as task-list state', async () => {
    const mod = await import('./claudeWorkState').catch(() => null);
    expect(mod?.createClaudeTaskToolWorkStateTracker).toEqual(expect.any(Function));

    const tracker = mod!.createClaudeTaskToolWorkStateTracker({
      backendId: 'claude',
      agentId: 'claude',
    });

    const createSnapshot = tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_create_1',
          name: 'TaskCreate',
          input: {
            subject: 'Patch task projection',
            activeForm: 'Patching task projection',
          },
        }],
      },
    }, 400);

    expect(createSnapshot?.items).toEqual([
      expect.objectContaining({
        id: 'task:derived:claude.task:tool_use%3Atoolu_create_1',
        kind: 'task',
        status: 'pending',
        title: 'Patch task projection',
      }),
    ]);

    const resultSnapshot = tracker.applyMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_create_1',
          content: 'Task #1 created successfully: Patch task projection',
          tool_use_result: {
            task: {
              id: 'task_real_1',
              subject: 'Patch task projection',
              status: 'pending',
            },
          },
        }],
      },
    }, 401);

    expect(resultSnapshot?.items).toEqual([
      expect.objectContaining({
        id: 'task:derived:claude.task:task_real_1',
        kind: 'task',
        status: 'pending',
        title: 'Patch task projection',
        vendorRef: 'task_real_1',
      }),
    ]);

    const updateSnapshot = tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_update_1',
          name: 'TaskUpdate',
          input: {
            taskId: 'task_real_1',
            status: 'in_progress',
            subject: 'Run tests',
          },
        }],
      },
    }, 402);

    expect(updateSnapshot?.items).toEqual([
      expect.objectContaining({
        id: 'task:derived:claude.task:task_real_1',
        status: 'active',
        title: 'Run tests',
      }),
    ]);
  });

  it('preserves known task titles when TaskUpdate only carries task id and status', async () => {
    const mod = await import('./claudeWorkState');
    const tracker = mod.createClaudeTaskToolWorkStateTracker({
      backendId: 'claude',
      agentId: 'claude',
    });

    tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_create_17',
          name: 'TaskCreate',
          input: { subject: 'Define remote-dev vs dev implementation sequencing' },
        }],
      },
    }, 600);

    tracker.applyMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_create_17',
          tool_use_result: {
            task: {
              id: '17',
              subject: 'Define remote-dev vs dev implementation sequencing',
              status: 'pending',
            },
          },
        }],
      },
    }, 601);

    const snapshot = tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_update_17',
          name: 'TaskUpdate',
          input: {
            taskId: '17',
            status: 'completed',
          },
        }],
      },
    }, 602);

    expect(snapshot?.items.map((item) => [item.vendorRef, item.status, item.title])).toEqual([
      ['17', 'complete', 'Define remote-dev vs dev implementation sequencing'],
    ]);
  });

  it('correlates plain-text TaskCreate results to later id-only TaskUpdate tool uses', async () => {
    const mod = await import('./claudeWorkState');
    const tracker = mod.createClaudeTaskToolWorkStateTracker({
      backendId: 'claude',
      agentId: 'claude',
    });

    tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_create_21',
          name: 'TaskCreate',
          input: { subject: 'Write synthesis response with recommendations' },
        }],
      },
    }, 700);

    const createResultSnapshot = tracker.applyMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_create_21',
          content: 'Task #21 created successfully: Write synthesis response with recommendations',
        }],
      },
    }, 701);

    expect(createResultSnapshot?.items.map((item) => [item.vendorRef, item.status, item.title])).toEqual([
      ['21', 'pending', 'Write synthesis response with recommendations'],
    ]);

    const updateSnapshot = tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_update_21',
          name: 'TaskUpdate',
          input: {
            taskId: '21',
            status: 'in_progress',
          },
        }],
      },
    }, 702);

    expect(updateSnapshot?.items.map((item) => [item.vendorRef, item.status, item.title])).toEqual([
      ['21', 'active', 'Write synthesis response with recommendations'],
    ]);
  });

  it('falls back to plain-text TaskCreate content when structured tool results contain no task record', async () => {
    const mod = await import('./claudeWorkState');
    const tracker = mod.createClaudeTaskToolWorkStateTracker({
      backendId: 'claude',
      agentId: 'claude',
    });

    tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_create_22',
          name: 'TaskCreate',
          input: { subject: 'Write rev 2 of unified Claude plan' },
        }],
      },
    }, 800);

    const snapshot = tracker.applyMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_create_22',
          content: 'Task #22 created successfully: Write rev 2 of unified Claude plan',
          tool_use_result: { ok: true },
        }],
      },
    }, 801);

    expect(snapshot?.items.map((item) => [item.vendorRef, item.status, item.title])).toEqual([
      ['22', 'pending', 'Write rev 2 of unified Claude plan'],
    ]);
  });

  it('bounds tracked TaskList snapshots and marks omitted items as truncated', async () => {
    const mod = await import('./claudeWorkState');
    const tracker = mod.createClaudeTaskToolWorkStateTracker({
      backendId: 'claude',
      agentId: 'claude',
      maxItems: 1,
    });

    tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_list_1',
          name: 'TaskList',
          input: {},
        }],
      },
    }, 501);

    const snapshot = tracker.applyMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_list_1',
          tool_use_result: {
            tasks: [
              { id: 'task_a', subject: 'Author tests', status: 'pending' },
              { id: 'task_b', subject: 'Ship parser', status: 'pending' },
            ],
          },
        }],
      },
    }, 502);

    expect(snapshot?.items.map((item: any) => item.title)).toEqual(['Author tests']);
    expect(snapshot?.truncated).toEqual({
      reason: 'item_limit',
      omittedCount: 1,
    });
  });

  it('replaces task-list state from TaskList tool results', async () => {
    const mod = await import('./claudeWorkState').catch(() => null);
    const tracker = mod!.createClaudeTaskToolWorkStateTracker({
      backendId: 'claude',
      agentId: 'claude',
    });

    tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_create_1',
          name: 'TaskCreate',
          input: { subject: 'Stale task' },
        }],
      },
    }, 500);

    tracker.applyMessage({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_list_1',
          name: 'TaskList',
          input: {},
        }],
      },
    }, 501);

    const snapshot = tracker.applyMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_list_1',
          content: 'Listed tasks',
          tool_use_result: {
            tasks: [
              { id: 'task_a', subject: 'Author tests', status: 'completed' },
              { id: 'task_b', subject: 'Ship parser', status: 'pending' },
            ],
          },
        }],
      },
    }, 502);

    expect(snapshot?.items.map((item: any) => [item.vendorRef, item.status, item.title])).toEqual([
      ['task_a', 'complete', 'Author tests'],
      ['task_b', 'pending', 'Ship parser'],
    ]);
  });
});
