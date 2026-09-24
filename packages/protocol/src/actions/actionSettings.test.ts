import { describe, expect, it } from 'vitest';

import { ActionIdSchema } from './actionIds.js';
import { ActionsSettingsV1Schema, isActionEnabledByActionsSettings } from './actionSettings.js';

describe('ActionsSettingsV1Schema', () => {
  it('accepts per-action overrides and enforces per-surface + per-placement disablement', () => {
    const parsed = ActionsSettingsV1Schema.parse({
      v: 1,
      actions: {
        'review.start': {
          enabled: false,
        },
        'subagents.plan.start': {
          disabledSurfaces: ['mcp'],
          disabledPlacements: ['command_palette'],
          approvalRequiredSurfaces: ['cli'],
          toolExposureModes: {
            session_agent: 'direct',
            mcp: 'discoverable_only',
          },
        },
        'subagents.delegate.start': {
          disabledSurfaces: ['session_agent'],
          enabledPlacements: ['agent_input_chips'],
        },
        'unknown.action': {
          enabled: false,
        },
      },
    });
    expect(parsed.v).toBe(1);
    expect(Object.keys(parsed.actions)).toEqual(['review.start', 'subagents.plan.start', 'subagents.delegate.start']);

    expect(isActionEnabledByActionsSettings('review.start' as any, parsed)).toBe(false);
    expect(isActionEnabledByActionsSettings('subagents.plan.start' as any, parsed)).toBe(true);
    expect(isActionEnabledByActionsSettings('subagents.plan.start' as any, parsed, { surface: 'mcp' } as any)).toBe(false);
    expect(isActionEnabledByActionsSettings('subagents.plan.start' as any, parsed, { surface: 'ui_button' } as any)).toBe(true);
    expect(isActionEnabledByActionsSettings('subagents.plan.start' as any, parsed, { placement: 'command_palette' } as any)).toBe(false);
    expect(isActionEnabledByActionsSettings('subagents.plan.start' as any, parsed, { placement: 'agent_input_chips' } as any)).toBe(false);

    // Opt-in placement: disabled by default unless explicitly enabled.
    expect(isActionEnabledByActionsSettings('subagents.delegate.start' as any, parsed, { placement: 'agent_input_chips' } as any)).toBe(true);

    // Per-surface disablement should support the session agent surface.
    expect(isActionEnabledByActionsSettings('subagents.delegate.start' as any, parsed, { surface: 'session_agent' } as any)).toBe(false);

    // Ensure action ids remain the canonical ActionId schema.
    expect(() => ActionIdSchema.parse('review.start')).not.toThrow();

    expect(parsed.actions['subagents.plan.start' as keyof typeof parsed.actions].toolExposureModes).toEqual({
      session_agent: 'direct',
      mcp: 'discoverable_only',
    });
  });

  it('normalizes legacy subagent action ids to the new persisted ids', () => {
    const parsed = ActionsSettingsV1Schema.parse({
      v: 1,
      actions: {
        'plan.start': {
          disabledPlacements: ['command_palette'],
        },
        'delegate.start': {
          enabledPlacements: ['agent_input_chips'],
        },
      },
    });

    expect(parsed.actions['subagents.plan.start' as keyof typeof parsed.actions]).toEqual({
      enabledPlacements: [],
      disabledSurfaces: [],
      disabledPlacements: ['command_palette'],
      approvalRequiredSurfaces: [],
      toolExposureModes: {},
    });
    expect(parsed.actions['subagents.delegate.start' as keyof typeof parsed.actions]).toEqual({
      enabledPlacements: ['agent_input_chips'],
      disabledSurfaces: [],
      disabledPlacements: [],
      approvalRequiredSurfaces: [],
      toolExposureModes: {},
    });
  });

  it('gates reset-credit consume independently from usage-limit check-now', () => {
    const parsed = ActionsSettingsV1Schema.parse({
      v: 1,
      actions: {
        'session.usageLimit.consumeResetCredit': {
          disabledSurfaces: ['mcp'],
          approvalRequiredSurfaces: ['cli'],
        },
      },
    });

    expect(isActionEnabledByActionsSettings('session.usageLimit.checkNow' as any, parsed, { surface: 'mcp' } as any)).toBe(true);
    expect(isActionEnabledByActionsSettings('session.usageLimit.consumeResetCredit' as any, parsed, { surface: 'mcp' } as any)).toBe(false);
    expect(isActionEnabledByActionsSettings('session.usageLimit.consumeResetCredit' as any, parsed, { surface: 'cli' } as any)).toBe(true);
  });

  it('normalizes legacy session_control_cli surface overrides to cli', () => {
    const parsed = ActionsSettingsV1Schema.parse({
      v: 1,
      actions: {
        'review.start': {
          disabledSurfaces: ['session_control_cli'],
        },
      },
    });

    expect(parsed.actions['review.start' as keyof typeof parsed.actions]).toEqual({
      enabledPlacements: [],
      disabledSurfaces: ['cli'],
      disabledPlacements: [],
      approvalRequiredSurfaces: [],
      toolExposureModes: {},
    });
    expect(isActionEnabledByActionsSettings('review.start' as any, parsed, { surface: 'cli' } as any)).toBe(false);
  });

  it('filters invalid tool exposure settings to the supported tool surfaces', () => {
    const parsed = ActionsSettingsV1Schema.parse({
      v: 1,
      actions: {
        'subagents.delegate.start': {
          toolExposureModes: {
            session_agent: 'direct',
            mcp: 'discoverable_only',
            cli: 'direct',
            voice_tool: 'direct',
            unknown: 'direct',
          },
        },
      },
    });

    expect(parsed.actions['subagents.delegate.start' as keyof typeof parsed.actions].toolExposureModes).toEqual({
      session_agent: 'direct',
      mcp: 'discoverable_only',
      cli: 'direct',
    });
  });
});
