import { describe, expect, it } from 'vitest';

import { normalizeOpenCodeAppSkills } from './appSkills.js';

describe('OpenCode app skills wire schema', () => {
    it('normalizes skill catalog items without exposing raw skill content', () => {
        const skills = normalizeOpenCodeAppSkills([
            {
                name: 'reviewer',
                description: 'Review code',
                location: '/repo/.agents/skills/reviewer/SKILL.md',
                content: 'secret instructions',
            },
        ]);

        expect(skills).toEqual([
            {
                name: 'reviewer',
                displayName: 'reviewer',
                description: 'Review code',
                path: '/repo/.agents/skills/reviewer/SKILL.md',
                origin: 'opencode_native',
                enabled: true,
            },
        ]);
        expect(JSON.stringify(skills)).not.toContain('secret instructions');
    });
});
