import { describe, expect, it } from 'vitest';
import { readDesktopControlSnapshot } from './desktopControlSnapshot';
import { readDesktopConversationObservation } from './desktopConversationObservation';

/** 合成 Desktop 外部快照验证同轮审批绑定，不接触真实任务。 */
function snapshot() {
    return { id: 'thread-test', cwd: '/synthetic/project', threadRuntimeStatus: { type: 'active' }, turns: [{ turnId: 'turn-test', status: 'inProgress', items: [] }], requests: [
        { id: 7, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-test', turnId: 'turn-test', command: 'echo synthetic', cwd: '/synthetic/project' } },
    ] };
}
describe('Desktop control snapshot', () => {
    // Desktop 12111 的计划请求保留原 ID 类型和问题级输入约束，不复用审批归一化。
    it('投影计划多题及原生答案记录，旧读取不增加提问字段', () => {
        const value = { ...snapshot(), requests: [{ id: 7, method: 'item/tool/requestUserInput', params: {
            threadId: 'thread-test', turnId: 'turn-test', itemId: 'tool-1', questions: [
                { id: 'choice', header: '选择', question: '选择方案', isOther: true, isSecret: false,
                    options: [{ label: '甲', description: '说明' }] },
                { id: 'secret', header: '输入', question: '输入验证值', isOther: false, isSecret: true, options: [] },
            ],
        } }] };
        expect(readDesktopControlSnapshot(value, 'thread-test')).not.toHaveProperty('questions');
        const projected = readDesktopControlSnapshot(value, 'thread-test', true).questions![0]!;
        expect(projected).toMatchObject({ kind: 'user_input', requestId: 7, itemId: 'tool-1', turnId: 'turn-test',
            status: 'pending', canAnswer: true, questions: value.requests[0]!.params.questions });
        const answered = { ...value, requests: [], turns: [{ turnId: 'turn-test', status: 'inProgress', items: [
            { id: 'user-input-response-7', type: 'userInputResponse', requestId: 7, turnId: 'turn-test', completed: true,
                questions: value.requests[0]!.params.questions.map(({ isOther, isSecret, ...question }) => question),
                answers: { choice: ['甲'], secret: ['synthetic'] } },
        ] }] };
        expect(readDesktopControlSnapshot(answered, 'thread-test', true).questions![0]).toMatchObject({
            status: 'answered', canAnswer: false, requestId: 7, answers: { choice: ['甲'], secret: ['synthetic'] },
        });
        expect(readDesktopControlSnapshot(answered, 'thread-test', true).questions![0]!.questions[1]).not.toHaveProperty('isSecret');
    });

    it('桌面已答但原请求暂未删除时不再显示待回复，错轮回显不算回答', () => {
        const request = { id: '7', method: 'item/tool/requestUserInput', params: { threadId: 'thread-test', turnId: 'turn-test', itemId: 'tool-1',
            questions: [{ id: 'first', header: '选择', question: '选一个', isOther: false, options: [{ label: '甲', description: '' }] }] } };
        const response = { type: 'userInputResponse', id: 'response', requestId: '7', turnId: 'wrong-turn', completed: true,
            questions: request.params.questions, answers: { first: ['甲'] } };
        const value = { ...snapshot(), requests: [request], turns: [{ turnId: 'turn-test', status: 'inProgress', items: [response] }] };
        expect(readDesktopControlSnapshot(value, 'thread-test', true).questions![0]!.status).toBe('pending');
        response.turnId = 'turn-test';
        expect(readDesktopControlSnapshot(value, 'thread-test', true).questions![0]!.status).toBe('answered');
        expect(readDesktopConversationObservation(value, 'thread-test')).toMatchObject({ state: 'running' });
    });

    // 提问不是权限审批；混合待办的两个入口各自显示原请求，未知种类仍保留。
    it.each([false, true])('includeQuestions=%s 时审批列表不混入计划题且不削弱发送约束', (includeQuestions) => {
        const base = snapshot();
        const plan = { id: 9, method: 'item/tool/requestUserInput', params: { threadId: 'thread-test', turnId: 'turn-test', itemId: 'tool-1',
            questions: [{ id: 'first', header: '选择', question: '选一个', isOther: false, options: [{ label: '甲', description: '' }] }] } };
        const unknown = { id: 10, method: 'item/future/requestUnknown', params: { threadId: 'thread-test', turnId: 'turn-test' } };
        const mixed = { ...base, requests: [...base.requests, plan, unknown] };
        const projected = readDesktopControlSnapshot(mixed, 'thread-test', includeQuestions);
        expect(projected.requests).toEqual([
            expect.objectContaining({ requestId: '7', kind: 'command', canDecide: true }),
            expect.objectContaining({ requestId: '10', kind: 'unsupported', canDecide: false }),
        ]);
        expect(projected.textSendMode).toBe('steer');
        if (includeQuestions) expect(projected.questions).toEqual([expect.objectContaining({ requestId: 9, kind: 'user_input', canAnswer: true })]);
        else expect(projected).not.toHaveProperty('questions');
        const terminal = { ...base, requests: [plan], threadRuntimeStatus: { type: 'idle' },
            turns: [{ turnId: 'turn-test', status: 'completed', items: [] }] };
        expect(readDesktopControlSnapshot(terminal, 'thread-test', includeQuestions).requests).toEqual([]);
        expect(readDesktopControlSnapshot(terminal, 'thread-test', includeQuestions)).not.toHaveProperty('textSendMode');
    });

    // Q03/Q04 已验证异步卡位于 agentMessage，回显必须是结构化且 accepted；普通正文不能代答。
    it('异步多题与同轮观察共用未答判定，桌面已答及过期不继续提示', () => {
        const card = { id: 'card-1', type: 'agentMessage', questions: [{ title: '选一个', options: ['甲', '乙'] }, { title: '补充', options: [] }] };
        const items: unknown[] = [card];
        const value = { ...snapshot(), requests: [], turns: [{ turnId: 'turn-test', status: 'inProgress', items }] };
        const projected = readDesktopControlSnapshot(value, 'thread-test', true).questions![0]!;
        expect(projected).toMatchObject({ kind: 'async_questions', requestId: null, itemId: 'card-1', status: 'pending', canAnswer: true });
        expect(projected.questions.map((question) => question.id)).toEqual([0, 1].map((index) => JSON.stringify(['request_user_input_async', 'card-1', index])));
        expect(readDesktopConversationObservation(value, 'thread-test')).toMatchObject({ state: 'needs_input', requests: [
            { kind: 'user_action_request' }, { kind: 'user_action_request' },
        ] });
        const replies = projected.questions.map((question, index) => ({ questionItemId: question.id, question: question.question, answer: index ? '自填' : '乙' }));
        const reply = { id: 'reply-1', type: 'steeringUserMessage', targetTurnId: 'turn-test', status: 'pending',
            input: [{ type: 'text', text: `<send_user_message_question_reply>\n${JSON.stringify(replies)}\n</send_user_message_question_reply>` }] };
        items.push(reply);
        expect(readDesktopControlSnapshot(value, 'thread-test', true).questions![0]!.status).toBe('pending');
        reply.status = 'accepted';
        expect(readDesktopControlSnapshot(value, 'thread-test', true).questions![0]).toMatchObject({ status: 'answered', canAnswer: false });
        expect(readDesktopConversationObservation(value, 'thread-test')).toMatchObject({ state: 'running' });
        items.pop();
        value.turns[0]!.status = 'completed';
        value.threadRuntimeStatus.type = 'idle';
        expect(readDesktopControlSnapshot(value, 'thread-test', true).questions![0]).toMatchObject({ status: 'expired', canAnswer: false });
    });

    it('binds file approval revisions to the actual proposed diff', () => {
        const value = { id: 'thread-test', threadRuntimeStatus: { type: 'active' }, turns: [{ turnId: 'turn-test', status: 'inProgress', items: [
            { id: 'change-1', type: 'fileChange', changes: [{ path: '/synthetic/file', kind: { type: 'update' }, diff: '-old\n+new' }] },
        ] }], requests: [{ id: 8, method: 'item/fileChange/requestApproval', params: { threadId: 'thread-test', turnId: 'turn-test', itemId: 'change-1' } }] };
        const first = readDesktopControlSnapshot(value, 'thread-test').requests[0]!;
        expect(first).toMatchObject({ kind: 'file_change', canDecide: true, files: [{ path: '/synthetic/file', diff: '-old\n+new' }] });
        value.turns[0]!.items[0]!.changes[0]!.diff = '-old\n+different';
        expect(readDesktopControlSnapshot(value, 'thread-test').requests[0]!.revision).not.toBe(first.revision);
    });
    it('返回真实请求详情和稳定修订，过滤其他任务或旧轮请求', () => {
        const value = snapshot();
        const result = readDesktopControlSnapshot(value, 'thread-test');
        expect(result).toMatchObject({ turnId: 'turn-test', state: 'running', requests: [{ requestId: '7', kind: 'command', command: 'echo synthetic' }] });
        const revision = result.requests[0]?.revision;
        value.requests.push({ ...value.requests[0], id: 9, params: { ...value.requests[0].params, turnId: 'old-turn' } });
        expect(readDesktopControlSnapshot(value, 'thread-test').requests).toHaveLength(1);
        value.requests[0].params.command = 'echo changed';
        expect(readDesktopControlSnapshot(value, 'thread-test').requests[0]?.revision).not.toBe(revision);
    });
    it('不把无命令详情的请求开放为允许，也不把缺失尾轮当空闲', () => {
        const value = snapshot();
        value.requests[0].params.command = '';
        expect(readDesktopControlSnapshot(value, 'thread-test').requests[0]?.canDecide).toBe(false);
        expect(() => readDesktopControlSnapshot({ id: 'thread-test', requests: [] }, 'thread-test')).toThrow();
    });

    // 冷开的静止历史仍可向原 owner 开始新轮，但这里只证明本次读取的文本选路。
    it.each(['completed', 'failed', 'interrupted'])('允许明确 idle 的 %s 历史开始新轮', (status) => {
        const value = { ...snapshot(), threadRuntimeStatus: { type: 'idle' }, requests: [],
            turns: [{ turnId: 'turn-test', status, items: [] }] };
        expect(readDesktopControlSnapshot(value, 'thread-test')).toMatchObject({
            textSendMode: 'start', state: status === 'interrupted' ? 'cancelled' : status,
        });
    });

    // 审批等待不改变原轮次的追加路由，不能误开新轮。
    it('只为 active 且当前轮明确运行的快照声明 steer', () => {
        expect(readDesktopControlSnapshot(snapshot(), 'thread-test')).toMatchObject({ textSendMode: 'steer', state: 'running' });
    });

    // 实时运行状态和历史尾轮必须一致；缺失或不能判定的 runtime 不能当空闲。
    it.each([
        ['active', 'completed'], ['active', 'failed'], ['active', 'interrupted'],
        ['idle', 'inProgress'], ['notLoaded', 'completed'], ['systemError', 'completed'],
        [undefined, 'completed'], [undefined, 'inProgress'],
    ])('拒绝 runtime=%s 与尾轮=%s 的不可信控制快照', (runtime, status) => {
        const value = { ...snapshot(), requests: [], threadRuntimeStatus: runtime ? { type: runtime } : undefined,
            turns: [{ turnId: 'turn-test', status, items: [] }] };
        expect(() => readDesktopControlSnapshot(value, 'thread-test')).toThrow();
    });

    // 原 owner 也阻止未确认提交后的新文本，不能因历史看似空闲绕过这个约束。
    it.each(['idle', 'active'])('runtime=%s 仍有未确认提交时不声明文本模式', (runtime) => {
        const value = { ...snapshot(), requests: [], threadRuntimeStatus: { type: runtime },
            turns: [{ turnId: 'turn-test', status: runtime === 'idle' ? 'completed' : 'inProgress', items: [] }],
            unconfirmedTurnSubmissions: [{ requestId: 'unconfirmed-submission' }] };
        expect(readDesktopControlSnapshot(value, 'thread-test')).not.toHaveProperty('textSendMode');
    });

    // 终态与同轮未决请求互相矛盾；不能只因 runtime idle 发出 start。
    it('同轮仍有未决请求时不开放终态的新文本发送', () => {
        const value = { ...snapshot(), threadRuntimeStatus: { type: 'idle' },
            turns: [{ turnId: 'turn-test', status: 'completed', items: [] }] };
        expect(readDesktopControlSnapshot(value, 'thread-test')).not.toHaveProperty('textSendMode');
    });

    // 只要求最新尾岛可确认，旧历史尚未加载不会阻止普通冷开历史的新轮。
    it('使用 canonical 最新尾岛，并拒绝身份不符或尾部有缺口的快照', () => {
        const value = { ...snapshot(), requests: [], threadRuntimeStatus: { type: 'idle' }, turns: [],
            turnHistory: { kind: 'canonical', history: { isComplete: false,
                entitiesByKey: { latest: { turnId: 'turn-latest', status: 'completed', items: [] } },
                islands: [{ newerBoundary: { status: 'exhausted' }, entries: [{ value: 'latest' }] }] } } };
        expect(readDesktopControlSnapshot(value, 'thread-test')).toMatchObject({ turnId: 'turn-latest', textSendMode: 'start' });
        expect(() => readDesktopControlSnapshot(value, 'other-thread')).toThrow();
        value.turnHistory.history.islands[0]!.newerBoundary.status = 'unknown';
        expect(() => readDesktopControlSnapshot(value, 'thread-test')).toThrow();
    });
});
