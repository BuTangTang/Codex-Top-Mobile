import { describe, expect, it } from 'vitest';

import { ClaudeSdkSkillsOptionSchema, normalizeClaudeSdkInitSkills } from './sdkSkills.js';

describe('Claude SDK skill schemas', () => {
    it('accepts SDK skills option shapes', () => {
        expect(ClaudeSdkSkillsOptionSchema.parse('all')).toBe('all');
        expect(ClaudeSdkSkillsOptionSchema.parse(['reviewer'])).toEqual(['reviewer']);
    });

    it('normalizes system init skill names into enabled catalog items', () => {
        expect(normalizeClaudeSdkInitSkills(['reviewer'])).toEqual([
            {
                name: 'reviewer',
                displayName: 'reviewer',
                origin: 'claude_native',
                enabled: true,
            },
        ]);
    });
});
