import { describe, expect, it } from 'vitest';
import { DesktopControlSnapshotV1Schema } from './desktopControlV1';

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
