import type { AgentCoreConfig } from '@/agents/registry/registryCore';
import { buildCatalogProviderCliUiConfig } from '@/agents/providers/shared/buildCatalogProviderCliUiConfig';
import { buildAgentConnectedServicesUiConfig } from '@/agents/registry/buildAgentConnectedServicesUiConfig';
import { buildAgentLocalControlUiConfig } from '@/agents/registry/buildAgentLocalControlUiConfig';
import { buildAgentResumeUiConfig } from '@/agents/registry/buildAgentResumeUiConfig';
import { buildAgentSessionStorageUiConfig } from '@/agents/registry/buildAgentSessionStorageUiConfig';
import { buildAgentToolsUiConfig } from '@/agents/registry/buildAgentToolsUiConfig';
import { getAgentModelConfig, getAgentSessionModesKind } from '@happier-dev/agents';

export const CURSOR_CORE: AgentCoreConfig = {
    id: 'cursor',
    displayNameKey: 'agentInput.agent.cursor',
    subtitleKey: 'profiles.aiBackend.cursorSubtitleExperimental',
    permissionModeI18nPrefix: 'agentInput.codexPermissionMode',
    availability: { experimental: true },
    connectedServices: buildAgentConnectedServicesUiConfig({ agentId: 'cursor' }),
    uiConnectedService: { serviceId: null, label: 'Cursor', connectRoute: null },
    flavorAliases: ['cursor', 'cursor-agent'],
    cli: buildCatalogProviderCliUiConfig('cursor'),
    permissions: {
        modeGroup: 'codexLike',
        promptProtocol: 'codexDecision',
    },
    sessionModes: {
        kind: getAgentSessionModesKind('cursor'),
    },
    model: getAgentModelConfig('cursor'),
    resume: buildAgentResumeUiConfig({
        agentId: 'cursor',
        uiVendorResumeIdLabelKey: 'sessionInfo.cursorSessionId',
        uiVendorResumeIdCopiedKey: 'sessionInfo.cursorSessionIdCopied',
    }),
    localControl: buildAgentLocalControlUiConfig({ agentId: 'cursor' }),
    toolRendering: {
        hideUnknownToolsByDefault: true,
    },
    tools: buildAgentToolsUiConfig({ agentId: 'cursor' }),
    sessionStorage: buildAgentSessionStorageUiConfig({ agentId: 'cursor' }),
    ui: {
        agentPickerIconName: 'code-slash-outline',
        cliGlyphScale: 1.0,
        profileCompatibilityGlyphScale: 1.0,
    },
};
