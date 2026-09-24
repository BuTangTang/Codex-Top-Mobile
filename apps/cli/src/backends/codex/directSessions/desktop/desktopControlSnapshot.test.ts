import { describe, expect, it } from 'vitest';
import { readDesktopControlSnapshot } from './desktopControlSnapshot';

/** 合成 Desktop 外部快照验证同轮审批绑定，不接触真实任务。 */
function snapshot() {
    return { id: 'thread-test', cwd: '/synthetic/project', threadRuntimeStatus: { type: 'active' }, turns: [{ turnId: 'turn-test', status: 'inProgress', items: [] }], requests: [
        { id: 7, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-test', turnId: 'turn-test', command: 'echo synthetic', cwd: '/synthetic/project' } },
    ] };
}
describe('Desktop control snapshot', () => {
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
