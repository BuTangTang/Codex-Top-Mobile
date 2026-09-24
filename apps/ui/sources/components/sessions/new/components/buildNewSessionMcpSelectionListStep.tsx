import * as React from 'react';

import type {
    DaemonMcpServersPreviewResponse,
    McpServerCatalogEntryV1,
    McpServersSettingsV1,
    SessionMcpSelectionV1,
} from '@happier-dev/protocol';
import { resolveManagedSessionMcpSelectionV1 } from '@happier-dev/protocol';

import { getAgentCore, type AgentId } from '@/agents/catalog/catalog';
import {
    resolveAuthBadgeLabel,
    resolveDetectedAvailabilityLabel,
    resolveManagedServerAuthMode,
    resolvePreviewScopeLabel,
} from '@/components/settings/mcpServers/mcpServerUi';
import {
    setManagedSessionMcpServersEnabled,
    toggleManagedSessionMcpSelection,
} from '@/components/sessions/new/modules/sessionMcpSelectionState';
import { Switch } from '@/components/ui/forms/Switch';
import {
    StatusPill,
    type SelectionListOption,
    type SelectionListSectionDescriptor,
    type SelectionListStatusVariant,
    type SelectionListStep,
} from '@/components/ui/selectionList';
import { t } from '@/text';

type PreviewSuccess = Extract<DaemonMcpServersPreviewResponse, { ok: true }>;

export type BuildNewSessionMcpSelectionListStepArgs = Readonly<{
    machineId?: string | null;
    directory: string;
    agentType: AgentId;
    hasContext: boolean;
    loading: boolean;
    preview: PreviewSuccess | null;
    previewUnsupported?: boolean;
    error: string | null;
    selection: SessionMcpSelectionV1;
    mcpServersSettings: McpServersSettingsV1;
    happierHeaderRightAccessory: React.ReactNode;
    detectedHeaderRightAccessory: React.ReactNode;
    onSelectionChange: (selection: SessionMcpSelectionV1) => void;
}>;

function describeManagedReason(reasonCode: string): string {
    switch (reasonCode) {
        case 'active_by_default':
            return t('newSession.mcpReasonActiveByDefault');
        case 'forced_included':
            return t('newSession.mcpReasonForcedIncluded');
        case 'forced_excluded':
            return t('newSession.mcpReasonForcedExcluded');
        case 'managed_servers_disabled':
            return t('newSession.mcpReasonManagedDisabled');
        case 'binding_disabled':
            return t('newSession.mcpReasonBindingDisabled');
        case 'available_portable':
            return t('newSession.mcpReasonAvailablePortable');
        case 'not_portable':
            return t('newSession.mcpReasonNotPortable');
        default:
            return t('newSession.mcpReasonNotPortable');
    }
}

function resolveManagedAvailabilityLabel(availability: 'active' | 'available' | 'unavailable'): string {
    if (availability === 'active') return t('settings.mcpServersStatusActive');
    if (availability === 'available') return t('settings.mcpServersStatusAvailable');
    return t('settings.mcpServersStatusUnavailable');
}

function resolveManagedAvailabilityVariant(
    availability: 'active' | 'available' | 'unavailable',
): SelectionListStatusVariant {
    if (availability === 'active') return 'clean';
    if (availability === 'available') return 'info';
    return 'neutral';
}

function resolveDetectedAvailabilityVariant(entry: {
    enabled: boolean | null;
    availability: 'active' | 'available' | 'unavailable' | 'readOnly';
}): SelectionListStatusVariant {
    if (entry.enabled === false || entry.availability === 'unavailable') return 'neutral';
    if (entry.availability === 'active') return 'clean';
    return 'info';
}

function createMcpStatusAccessory(args: Readonly<{
    testID: string;
    label: string;
    variant: SelectionListStatusVariant;
}>): React.ReactElement {
    return (
        <StatusPill
            testID={args.testID}
            variant={args.variant}
            label={args.label}
            hideDot={true}
        />
    );
}

function createInfoOption(testID: string, label: string, subtitle?: string): SelectionListOption {
    return {
        id: testID,
        testID,
        label,
        subtitle,
        disabled: true,
    };
}

function sortHappierServers(
    servers: ReadonlyArray<McpServerCatalogEntryV1>,
): ReadonlyArray<McpServerCatalogEntryV1> {
    return servers
        .slice()
        .sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name));
}

function resolveManagedItems(args: BuildNewSessionMcpSelectionListStepArgs) {
    if (!args.machineId || !args.directory.trim()) return null;
    try {
        return resolveManagedSessionMcpSelectionV1(args.mcpServersSettings, {
            machineId: args.machineId,
            directory: args.directory.trim(),
            selection: args.selection,
        });
    } catch {
        return null;
    }
}

function buildManagedServerOption(
    server: McpServerCatalogEntryV1,
    args: BuildNewSessionMcpSelectionListStepArgs,
    managedResolution: ReturnType<typeof resolveManagedItems>,
): SelectionListOption {
    const testID = `new-session.mcp.row.${server.id}`;
    const item = managedResolution?.itemsByName[server.name] ?? null;

    if (!item) {
        return createInfoOption(testID, server.title ?? server.name, server.title ? server.name : undefined);
    }

    const scopeKind = item.bindingTargetKind === 'allMachines'
        ? 'allMachines'
        : item.bindingTargetKind === 'workspace'
            ? 'workspace'
            : 'machine';
    const subtitle = [
        resolvePreviewScopeLabel(scopeKind),
        resolveManagedServerAuthMode(server),
        describeManagedReason(item.reasonCode),
    ].filter(Boolean).join(' · ');

    const toggleSelection = () => args.onSelectionChange(toggleManagedSessionMcpSelection(args.selection, {
        serverId: server.id,
        selected: item.selected,
        selectable: item.selectable,
        defaultSelected: item.defaultSelected,
    }));

    return {
        id: testID,
        testID,
        label: server.title ?? server.name,
        subtitle,
        disabled: !item.selectable,
        rightAccessory: item.selectable ? (
            <Switch
                value={item.selected}
                onValueChange={toggleSelection}
            />
        ) : createMcpStatusAccessory({
            testID: `${testID}.status`,
            label: resolveManagedAvailabilityLabel(item.availability),
            variant: resolveManagedAvailabilityVariant(item.availability),
        }),
        onSelect: item.selectable ? toggleSelection : undefined,
    };
}

function buildHappierOptions(
    args: BuildNewSessionMcpSelectionListStepArgs,
    happierServers: ReadonlyArray<McpServerCatalogEntryV1>,
    managedResolution: ReturnType<typeof resolveManagedItems>,
): ReadonlyArray<SelectionListOption> {
    if (happierServers.length === 0) {
        return [
            createInfoOption(
                'new-session.mcp.happier-empty',
                t('newSession.mcpHappierEmptyTitle'),
                t('newSession.mcpHappierEmptySubtitle'),
            ),
        ];
    }

    return [
        {
            id: 'new-session.mcp.managed-enabled',
            testID: 'new-session.mcp.managed-enabled',
            label: t('newSession.mcpManagedToggleTitle'),
            subtitle: args.selection.managedServersEnabled
                ? t('settings.mcpServersStatusActive')
                : t('settings.mcpServersStatusUnavailable'),
            rightAccessory: (
                <Switch
                    value={args.selection.managedServersEnabled}
                    onValueChange={(value) => {
                        args.onSelectionChange(setManagedSessionMcpServersEnabled(args.selection, value));
                    }}
                />
            ),
            onSelect: () => {
                args.onSelectionChange(setManagedSessionMcpServersEnabled(
                    args.selection,
                    !args.selection.managedServersEnabled,
                ));
            },
        },
        ...happierServers.map((server) => buildManagedServerOption(server, args, managedResolution)),
    ];
}

function shouldRenderDetectedSection(
    args: BuildNewSessionMcpSelectionListStepArgs,
    happierServerCount: number,
): boolean {
    if (!args.hasContext) return false;
    if (args.previewUnsupported) return true;
    if (Boolean(args.error)) return true;
    const detectedCount = args.preview?.detected.length ?? 0;
    return happierServerCount > 0 || detectedCount > 0;
}

function buildDetectedOptions(args: BuildNewSessionMcpSelectionListStepArgs): ReadonlyArray<SelectionListOption> {
    if (args.previewUnsupported) {
        return [
            createInfoOption(
                'new-session.mcp.detected-unsupported',
                t('newSession.mcpDetectedUnsupportedTitle'),
                t('newSession.mcpDetectedUnsupportedSubtitle'),
            ),
        ];
    }

    if (args.error) {
        return [
            createInfoOption(
                'new-session.mcp.detected-error',
                t('common.error'),
                args.error,
            ),
        ];
    }

    const detected = args.preview?.detected ?? [];
    if (detected.length === 0) {
        return [
            createInfoOption(
                'new-session.mcp.detected-empty',
                t('newSession.mcpDetectedEmptyTitle'),
                t('newSession.mcpDetectedEmptySubtitle'),
            ),
        ];
    }

    return detected.map((entry) => {
        const testID = `new-session.mcp.detected.${entry.name}`;
        return {
            id: testID,
            testID,
            label: entry.title || entry.name,
            subtitle: [
                resolvePreviewScopeLabel(entry.scopeKind),
                resolveAuthBadgeLabel(entry.authMode),
            ].filter(Boolean).join(' · '),
            disabled: true,
            rightAccessory: createMcpStatusAccessory({
                testID: `${testID}.status`,
                label: resolveDetectedAvailabilityLabel(entry),
                variant: resolveDetectedAvailabilityVariant(entry),
            }),
        };
    });
}

export function buildNewSessionMcpSelectionListStep(
    args: BuildNewSessionMcpSelectionListStepArgs,
): SelectionListStep {
    const happierServers = sortHappierServers(args.mcpServersSettings.servers);
    const managedResolution = resolveManagedItems(args);
    const agentDisplayName = t(getAgentCore(args.agentType).displayNameKey);
    const detectedSectionTitle = t('newSession.mcpDetectedSectionTitleForAgent', { agentName: agentDisplayName });
    const sections: SelectionListSectionDescriptor[] = [
        {
            kind: 'static',
            id: 'happier',
            title: t('newSession.mcpHappierSectionTitle'),
            headerRightAccessory: args.happierHeaderRightAccessory,
            options: buildHappierOptions(args, happierServers, managedResolution),
            virtualization: 'never',
        },
    ];

    if (!args.loading && !args.hasContext) {
        sections.push({
            kind: 'static',
            id: 'no-context',
            title: t('newSession.mcpUnavailableNoContextTitle'),
            options: [
                createInfoOption(
                    'new-session.mcp.empty',
                    t('newSession.mcpUnavailableNoContextTitle'),
                    t('newSession.mcpUnavailableNoContextSubtitle'),
                ),
            ],
            virtualization: 'never',
        });
    }

    if (shouldRenderDetectedSection(args, happierServers.length)) {
        sections.push({
            kind: 'static',
            id: 'detected',
            title: detectedSectionTitle,
            headerRightAccessory: args.detectedHeaderRightAccessory,
            options: buildDetectedOptions(args),
            virtualization: 'never',
        });
    }

    return {
        id: 'new-session-mcp',
        title: t('newSession.mcpChipLabel'),
        sections,
    };
}
