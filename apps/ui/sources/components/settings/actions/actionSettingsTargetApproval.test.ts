import { describe, expect, it } from 'vitest';

import type { ActionId } from '@happier-dev/protocol';

import * as actionSettingsTargets from './actionSettingsTargets';

type IsActionSettingsApprovalAction = (actionId: ActionId) => boolean;

function expectApprovalActionExport(): IsActionSettingsApprovalAction {
    const candidate = (
        actionSettingsTargets as typeof actionSettingsTargets & {
            isActionSettingsApprovalAction?: IsActionSettingsApprovalAction;
        }
    ).isActionSettingsApprovalAction;
    expect(typeof candidate).toBe('function');
    return candidate ?? (() => false);
}

describe('action settings target approval mapping', () => {
    it.each([
        ['mcp', 'mcp'],
        ['cli', 'cli'],
        ['session_agent', 'session_agent'],
        ['voice_tool', 'voice_tool'],
        ['voice_action_block', 'voice_action_block'],
        ['slash_command', 'ui_slash_command'],
    ] as const)('maps %s targets to the remote-dev %s approval surface', (targetId, surface) => {
        expect(actionSettingsTargets.resolveActionSettingsApprovalSurface('review.start', targetId)).toBe(surface);
    });

    it('maps contextual UI targets to the remote-dev ui_button approval surface', () => {
        expect(actionSettingsTargets.resolveActionSettingsApprovalSurface('approval.request.decide', 'contextual_ui')).toBe('ui_button');
    });

    it.each([
        'session_action_menu',
        'command_palette',
        'agent_input_chips',
        'voice_panel',
    ] as const)('does not map ordinary %s placements to approval surfaces', (targetId) => {
        expect(actionSettingsTargets.resolveActionSettingsApprovalSurface('review.start', targetId)).toBeNull();
    });

    it('identifies approval request actions as not approval-routeable', () => {
        const isActionSettingsApprovalAction = expectApprovalActionExport();

        expect(isActionSettingsApprovalAction('approval.request.create')).toBe(true);
        expect(isActionSettingsApprovalAction('approval.request.decide')).toBe(true);
        expect(isActionSettingsApprovalAction('review.start')).toBe(false);
    });
});
