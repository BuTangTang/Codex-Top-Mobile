import { describe, expect, it } from 'vitest';

import { CodexAppServerTurnInputItemSchema } from './appServerTurnInput.js';

describe('Codex app-server structured turn input schema', () => {
    it('accepts text, image, localImage, skill, and vendor plugin mention inputs', () => {
        expect(CodexAppServerTurnInputItemSchema.parse({ type: 'text', text: 'hello' })).toEqual({
            type: 'text',
            text: 'hello',
        });
        expect(CodexAppServerTurnInputItemSchema.parse({ type: 'image', url: 'https://example.com/image.png' }).type).toBe('image');
        expect(CodexAppServerTurnInputItemSchema.parse({ type: 'localImage', path: '/tmp/image.png' }).type).toBe('localImage');
        expect(CodexAppServerTurnInputItemSchema.parse({ type: 'skill', name: 'reviewer', path: '/skills/reviewer/SKILL.md' }).type).toBe('skill');
        expect(CodexAppServerTurnInputItemSchema.parse({ type: 'mention', name: 'gmail', path: 'plugin://gmail@openai-curated' }).type).toBe('mention');
    });
});
