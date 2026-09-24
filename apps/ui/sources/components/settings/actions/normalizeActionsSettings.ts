import {
    ActionsSettingsV1Schema,
    type ActionId,
    type ActionToolExposureMode,
    type ActionToolExposureSurface,
    type ActionsSettingsV1,
} from '@happier-dev/protocol';

type ParsedActionSettingsOverride = ActionsSettingsV1['actions'][ActionId];
type SparseActionSettingsOverride = Omit<ParsedActionSettingsOverride, 'toolExposureModes'> & Readonly<{
    toolExposureModes?: Partial<Record<ActionToolExposureSurface, ActionToolExposureMode>>;
}>;

function hasToolExposureOverrides(modes: ParsedActionSettingsOverride['toolExposureModes'] | undefined): boolean {
    return modes?.session_agent === 'direct'
        || modes?.session_agent === 'discoverable_only'
        || modes?.mcp === 'direct'
        || modes?.mcp === 'discoverable_only'
        || modes?.cli === 'direct'
        || modes?.cli === 'discoverable_only';
}

function pruneEmptyToolExposureModes(settings: ActionsSettingsV1): ActionsSettingsV1 {
    const actions: Partial<Record<ActionId, SparseActionSettingsOverride>> = {};
    const entries = Object.entries(settings.actions) as Array<[ActionId, ParsedActionSettingsOverride]>;

    for (const [actionId, override] of entries) {
        const { toolExposureModes, ...rest } = override;
        actions[actionId] = hasToolExposureOverrides(toolExposureModes)
            ? { ...rest, toolExposureModes }
            : rest;
    }

    // Protocol parsing materializes default empty maps; persisted UI settings remain sparse.
    return { v: 1, actions: actions as ActionsSettingsV1['actions'] };
}

export function normalizeActionsSettings(raw: unknown): ActionsSettingsV1 {
    const parsed = ActionsSettingsV1Schema.safeParse(raw ?? null);
    if (parsed.success) {
        return pruneEmptyToolExposureModes(parsed.data);
    }
    return { v: 1, actions: {} as ActionsSettingsV1['actions'] };
}
