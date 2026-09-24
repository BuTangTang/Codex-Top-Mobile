import { describe, expect, it } from 'vitest';

import { formatPathRelativeToHome } from './formatPathRelativeToHome';

describe('formatPathRelativeToHome', () => {
    it('converts Windows home-contained paths to ~/ form when the home dir has a trailing backslash', () => {
        expect(formatPathRelativeToHome(
            'C:\\Users\\alice\\Documents\\gitea\\vastmonitor',
            'C:\\Users\\alice\\',
        )).toBe('~/Documents/gitea/vastmonitor');
    });

    it('treats a Windows home directory with a trailing backslash as the home root', () => {
        expect(formatPathRelativeToHome(
            'C:\\Users\\alice\\',
            'C:\\Users\\alice\\',
        )).toBe('~');
    });

    it('does not rewrite sibling home-like prefixes on Windows', () => {
        expect(formatPathRelativeToHome(
            'C:\\Users\\alice2\\Documents\\gitea\\vastmonitor',
            'C:\\Users\\alice\\',
        )).toBe('C:\\Users\\alice2\\Documents\\gitea\\vastmonitor');
    });
});
