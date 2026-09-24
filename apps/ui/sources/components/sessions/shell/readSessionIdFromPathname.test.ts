import { describe, expect, it } from 'vitest';

import { readSessionIdFromPathname } from './readSessionIdFromPathname';

describe('readSessionIdFromPathname', () => {
    it('returns the decoded session id from a session route pathname', () => {
        expect(readSessionIdFromPathname('/session/session-2')).toBe('session-2');
        expect(readSessionIdFromPathname('/session/session%203')).toBe('session 3');
    });

    it('returns null when the pathname does not target a session', () => {
        expect(readSessionIdFromPathname('/settings/session')).toBeNull();
    });
});
