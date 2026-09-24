import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readProvisionPassword } from './createPasswordAccount';

describe('password provisioning stdin', () => {
    it('保留有效空白，只消除一行管道末尾换行', async () => {
        expect(await readProvisionPassword(Readable.from(['  synthetic password  \n']))).toBe('  synthetic password  ');
    });
    it('拒绝终端回显、多行和超限输入', async () => {
        const tty = Readable.from(['secret']);
        Object.assign(tty, { isTTY: true });
        await expect(readProvisionPassword(tty)).rejects.toThrow();
        await expect(readProvisionPassword(Readable.from(['first\nsecond\n']))).rejects.toThrow();
        await expect(readProvisionPassword(Readable.from(['x'.repeat(4099)]))).rejects.toThrow();
    });
});
