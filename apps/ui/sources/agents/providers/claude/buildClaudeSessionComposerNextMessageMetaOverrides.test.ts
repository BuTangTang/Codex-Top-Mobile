import { describe, expect, it } from 'vitest';

import { buildClaudeSessionComposerNextMessageMetaOverrides } from './buildClaudeSessionComposerNextMessageMetaOverrides';

describe('buildClaudeSessionComposerNextMessageMetaOverrides', () => {
    it('returns the base overrides untouched without config option overrides', () => {
        expect(buildClaudeSessionComposerNextMessageMetaOverrides({
            configOptionOverrides: null,
        })).toBeUndefined();
        expect(buildClaudeSessionComposerNextMessageMetaOverrides({
            configOptionOverrides: null,
            metaOverrides: { model: 'claude-fable-5' },
        })).toEqual({ model: 'claude-fable-5' });
    });

    it('maps the reasoning_effort override onto message meta', () => {
        expect(buildClaudeSessionComposerNextMessageMetaOverrides({
            configOptionOverrides: { v: 1, updatedAt: 1, overrides: { reasoning_effort: { updatedAt: 1, value: 'XHigh ' } } },
        })).toEqual({ reasoningEffort: 'xhigh' });
    });

    it('maps the ultracode override onto message meta as a boolean', () => {
        expect(buildClaudeSessionComposerNextMessageMetaOverrides({
            configOptionOverrides: { v: 1, updatedAt: 1, overrides: { ultracode: { updatedAt: 1, value: 'true' } } },
        })).toEqual({ ultracode: true });
        expect(buildClaudeSessionComposerNextMessageMetaOverrides({
            configOptionOverrides: { v: 1, updatedAt: 1, overrides: { ultracode: { updatedAt: 1, value: 'false' } } },
        })).toEqual({ ultracode: false });
    });

    it('combines effort and ultracode overrides with base overrides', () => {
        expect(buildClaudeSessionComposerNextMessageMetaOverrides({
            configOptionOverrides: {
                v: 1,
                updatedAt: 1,
                overrides: {
                    reasoning_effort: { updatedAt: 1, value: 'low' },
                    ultracode: { updatedAt: 1, value: 'true' },
                },
            },
            metaOverrides: { model: 'claude-fable-5' },
        })).toEqual({ model: 'claude-fable-5', reasoningEffort: 'low', ultracode: true });
    });
});
