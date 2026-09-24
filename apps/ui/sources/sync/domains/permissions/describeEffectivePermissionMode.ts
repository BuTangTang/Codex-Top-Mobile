import type { AgentType } from '@/sync/domains/models/modelOptions';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import type { Metadata } from '@/sync/domains/state/storageTypes';
import { DEFAULT_AGENT_ID, getAgentCore, resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { normalizePermissionModeForAgentType } from '@/sync/domains/permissions/permissionModeOptions';
import {
    readSessionConfigOptionsState,
    readSessionModelsState,
    readSessionModesState,
} from '@/sync/domains/sessionControl/readSessionControlMetadata';
import { parsePermissionIntentAlias, resolveProviderNativePermissionModeForAgent } from '@happier-dev/agents';

export type EffectivePermissionModeDescription = Readonly<{
    effectiveMode: PermissionMode;
    reasons: EffectivePermissionModeReason[];
    notes: string[];
}>;

export type EffectivePermissionModeReasonCode =
    | 'plan_not_supported_for_provider'
    | 'mode_mapped_for_provider'
    | 'read_only_enforced_by_tool_gating'
    | 'approval_setting_controls_auto_approval'
    | 'read_only_best_effort'
    | 'mcp_sandbox_restrictions_apply_on_spawn'
    | 'applies_on_next_message';

export type EffectivePermissionModeReason = Readonly<{
    code: EffectivePermissionModeReasonCode;
    params?: Readonly<Record<string, string>>;
}>;

/** 按既有权限原因生成说明文案，不改变权限判断。 */
function noteForReason(reason: EffectivePermissionModeReason): string {
    switch (reason.code) {
        case 'plan_not_supported_for_provider':
            return '此提供方不将计划模式视为权限，已回退为只读。如有独立的“模式”选项，请在那里设置。';
        case 'mode_mapped_for_provider':
            return `在此提供方中映射为 ${reason.params?.providerMode ?? 'default'}。`;
        case 'read_only_enforced_by_tool_gating':
            return 'Codex Top 通过工具权限控制强制只读，写入操作将被拒绝。';
        case 'approval_setting_controls_auto_approval':
            return '此设置控制工具自动批准；正在运行的会话的沙箱限制可能不会改变。';
        case 'read_only_best_effort':
            return '此提供方仅尽力实现只读，实际映射为默认模式。';
        case 'mcp_sandbox_restrictions_apply_on_spawn':
            return '此会话使用 MCP 沙箱：会话中途更改权限只会更新批准行为，沙箱和环境限制在会话启动时确定。';
        case 'applies_on_next_message':
            return '将应用于你发送的下一条消息。';
        default:
            return '';
    }
}

export function describeEffectivePermissionMode(_params: {
    agentType: AgentType;
    selectedMode: PermissionMode;
    metadata: Metadata | null;
    applyTiming: 'immediate' | 'next_prompt';
}): EffectivePermissionModeDescription {
    const agentId = resolveAgentIdFromFlavor(_params.agentType) ?? DEFAULT_AGENT_ID;
    const core = getAgentCore(agentId);
    const group = core.permissions.modeGroup;
    const hasAcpSessionMetadata = Boolean(
        readSessionModesState(_params.metadata) ||
        readSessionModelsState(_params.metadata) ||
        readSessionConfigOptionsState(_params.metadata),
    );

    const selected = (parsePermissionIntentAlias(_params.selectedMode) ?? 'default') as PermissionMode;
    const normalized = normalizePermissionModeForAgentType(selected, _params.agentType);
    const reasons: EffectivePermissionModeReason[] = [];

    let effectiveMode: PermissionMode = normalized;

    if (selected === 'plan') {
        reasons.push({ code: 'plan_not_supported_for_provider' });
    }

    const providerNative = resolveProviderNativePermissionModeForAgent({ agentId, mode: effectiveMode });
    if (providerNative !== effectiveMode) {
        reasons.push({ code: 'mode_mapped_for_provider', params: { providerMode: providerNative } });
    }

    if (group === 'codexLike') {
        if (effectiveMode === 'read-only') {
            reasons.push({ code: 'read_only_enforced_by_tool_gating' });
        } else if (effectiveMode === 'safe-yolo' || effectiveMode === 'yolo') {
            reasons.push({ code: 'approval_setting_controls_auto_approval' });
        }
    }

    if (effectiveMode === 'read-only' && providerNative !== 'read-only') {
        reasons.push({ code: 'read_only_best_effort' });
    }

    if (core.sessionModes.kind === 'acpPolicyPresets' && !hasAcpSessionMetadata) {
        reasons.push({ code: 'mcp_sandbox_restrictions_apply_on_spawn' });
    }

    if (_params.applyTiming === 'next_prompt') {
        reasons.push({ code: 'applies_on_next_message' });
    }

    const notes = reasons.map(noteForReason).filter(Boolean);
    return { effectiveMode, reasons, notes };
}
