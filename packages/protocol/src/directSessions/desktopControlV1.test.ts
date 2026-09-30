import { describe, expect, it } from 'vitest';
import { DesktopControlSnapshotV1Schema, DirectSessionControlActionRequestSchema, DirectSessionControlReadRequestSchema, DirectSessionControlResultSchema } from './desktopControlV1';

describe('Desktop text send mode', () => {
    // 旧连接组件没有该证明字段，新客户端仍能读快照，但不能凭旧状态放行文本。
    it('读取既有无模式快照且不补造发送证明', () => {
        const snapshot = { v: 1, turnId: 'turn-old', state: 'completed', requests: [] };
        expect(DesktopControlSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
    });

    // 对 wire 的模式值做闭合校验，不接受暗含自动回退的未知选路。
    it.each(['start', 'steer'])('保留生产者声明的 %s 模式', (textSendMode) => {
        const snapshot = { v: 1, turnId: 'turn-current', state: textSendMode === 'start' ? 'completed' : 'running', requests: [], textSendMode };
        expect(DesktopControlSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
    });

    it('拒绝协议未声明的模式', () => {
        expect(DesktopControlSnapshotV1Schema.safeParse({ v: 1, turnId: 'turn-current', state: 'completed', requests: [], textSendMode: 'auto' }).success).toBe(false);
    });
});

// 新提问能力只对主动请求开放，旧批准/拒绝客户端仍使用原快照和动作。
describe('Desktop question control wire', () => {
    it('只有显式 true 才请求题目，旧读取形状保持有效', () => {
        const target = { machineId: 'machine', sessionId: 'linked' };
        expect(DirectSessionControlReadRequestSchema.parse(target)).toEqual(target);
        expect(DirectSessionControlReadRequestSchema.parse({ ...target, includeQuestions: true })).toEqual({ ...target, includeQuestions: true });
        expect(DirectSessionControlReadRequestSchema.safeParse({ ...target, includeQuestions: false }).success).toBe(false);
    });
    it.each([7, '7', null])('保留原请求 ID %s 类型，完整答案沿独立动作传递', (requestId) => {
        const action = { machineId: 'machine', sessionId: 'linked', kind: 'answer', operationId: 'operation', expectedTurnId: 'turn',
            requestKind: requestId === null ? 'async_questions' : 'user_input', requestId, itemId: 'item', revision: 'revision', answers: { first: ['甲'], second: ['自填'] } };
        expect(DirectSessionControlActionRequestSchema.parse(action)).toEqual(action);
        expect(DirectSessionControlActionRequestSchema.safeParse({ ...action, answers: { first: ['甲', '乙'] } }).success).toBe(false);
        expect(DirectSessionControlActionRequestSchema.safeParse({ ...action, answers: { first: [] } }).success).toBe(false);
    });
    it('桌面记录不是执行接受，两个结果分别传递', () => {
        expect(DirectSessionControlResultSchema.parse({ status: 'recorded', turnId: 'turn' })).toEqual({ status: 'recorded', turnId: 'turn' });
        expect(DirectSessionControlResultSchema.safeParse({ status: 'recorded' }).success).toBe(false);
    });
});
