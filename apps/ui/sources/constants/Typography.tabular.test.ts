import { describe, expect, it } from 'vitest';

import { Typography } from './Typography';

describe('Typography.tabular', () => {
    it('exposes a tabular() helper', () => {
        expect(typeof Typography.tabular).toBe('function');
    });

    it('returns a style fragment with fontVariant set to tabular-nums', () => {
        const style = Typography.tabular();
        expect(style).toEqual({ fontVariant: ['tabular-nums'] });
    });

    it('returns a fresh object each call so consumers can spread it safely', () => {
        const a = Typography.tabular();
        const b = Typography.tabular();
        expect(a).not.toBe(b);
        expect(a).toEqual(b);
    });

    it('produces a fontVariant array containing exactly tabular-nums (single-purpose helper)', () => {
        const style = Typography.tabular();
        expect(Array.isArray(style.fontVariant)).toBe(true);
        expect(style.fontVariant).toHaveLength(1);
        expect(style.fontVariant?.[0]).toBe('tabular-nums');
    });
});
