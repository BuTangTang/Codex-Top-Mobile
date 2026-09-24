import { describe, expect, it } from 'vitest';
import type { AcpConfigOptionOverridesV1 } from '@happier-dev/protocol';

import {
    buildSessionComposerNextMessageMetaOverridesFromUiState,
    getSessionComposerNonSteerablePayloadReasonFromUiState,
} from './registryUiBehavior';

describe('buildSessionComposerNextMessageMetaOverridesFromUiState', () => {
    it('adds Claude reasoning effort from session config-option overrides while preserving existing meta', () => {
        expect(buildSessionComposerNextMessageMetaOverridesFromUiState({
            agentId: 'claude',
            configOptionOverrides: {
                v: 1,
                updatedAt: 12,
                overrides: {
                    reasoning_effort: {
                        updatedAt: 12,
                        value: 'low',
                    },
                },
            },
            metaOverrides: {
                happier: {
                    kind: 'attachments.v1',
                    payload: { attachments: [] },
                },
            },
        })).toEqual({
            happier: {
                kind: 'attachments.v1',
                payload: { attachments: [] },
            },
            reasoningEffort: 'low',
        });
    });

    it('leaves non-Claude sessions unchanged', () => {
        const metaOverrides = {
            happier: {
                kind: 'participant_message.v1',
                payload: { recipient: { kind: 'agent_team_member' } },
            },
        };

        expect(buildSessionComposerNextMessageMetaOverridesFromUiState({
            agentId: 'codex',
            configOptionOverrides: {
                v: 1,
                updatedAt: 12,
                overrides: {
                    reasoning_effort: {
                        updatedAt: 12,
                        value: 'low',
                    },
                },
            },
            metaOverrides,
        })).toBe(metaOverrides);
    });

    it('classifies fresh Claude model overrides as non-steerable provider config while busy', () => {
        expect(getSessionComposerNonSteerablePayloadReasonFromUiState({
            agentId: 'claude',
            session: {
                metadata: {
                    flavor: 'claude',
                    modelOverrideV1: { v: 1, modelId: 'claude-sonnet-4-6', updatedAt: 10 },
                },
                modelMode: 'claude-fable-5',
                modelModeUpdatedAt: 20,
            } as any,
            configOptionOverrides: null,
        })).toBe('provider_config_change_refused');
    });

    it('classifies fresh Claude reasoning and ultracode overrides as non-steerable provider config while busy', () => {
        const configOptionOverridesCases: AcpConfigOptionOverridesV1[] = [
            { v: 1, updatedAt: 20, overrides: { reasoning_effort: { updatedAt: 20, value: 'xhigh' } } },
            { v: 1, updatedAt: 20, overrides: { ultracode: { updatedAt: 20, value: 'true' } } },
        ];
        for (const configOptionOverrides of configOptionOverridesCases) {
            expect(getSessionComposerNonSteerablePayloadReasonFromUiState({
                agentId: 'claude',
                session: {
                    metadata: {
                        flavor: 'claude',
                        sessionConfigOptionOverridesV1: { v: 1, updatedAt: 10, overrides: {} },
                    },
                } as any,
                configOptionOverrides,
            })).toBe('provider_config_change_refused');
        }
    });

    it('does not classify non-Claude config overrides in the generic registry helper', () => {
        expect(getSessionComposerNonSteerablePayloadReasonFromUiState({
            agentId: 'codex',
            session: { metadata: { flavor: 'codex' } } as any,
            configOptionOverrides: {
                v: 1,
                updatedAt: 20,
                overrides: { reasoning_effort: { updatedAt: 20, value: 'high' } },
            },
        })).toBeNull();
    });
});
