import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installToolShellCommonModuleMocks } from './ToolView.testHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let settings: Record<string, unknown> = {};
const capturedHeaderProps: any[] = [];

installToolShellCommonModuleMocks({
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSetting: (key: string) => settings[key],
            },
        });
    },
});

vi.mock('@/components/ui/text/Text', async () => {
    return {
        Text: (props: any) => React.createElement('Text', props, props.children),
        TextInput: (props: any) => React.createElement('TextInput', props),
        TextSelectabilityScope: (props: any) => React.createElement('TextSelectabilityScope', props, props.children),
    };
});

vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

vi.mock('@/components/tools/catalog', () => ({
    knownTools: {},
}));

vi.mock('@/components/tools/renderers/system/MCPToolView', () => ({
    formatMCPTitle: (name: string) => name,
    formatMCPSubtitle: () => null,
}));

vi.mock('@/components/tools/renderers/core/_registry', () => ({
    getToolViewComponent: () => () => React.createElement('SpecificToolView'),
}));

vi.mock('@/components/tools/shell/presentation/ToolSectionView', async (importOriginal) => {
    const { installToolSectionViewModuleMock } = await import('@/dev/testkit/mocks/toolSectionView');
    return installToolSectionViewModuleMock('host')(importOriginal);
});

vi.mock('@/components/ui/media/CodeView', () => ({
    CodeView: (props: any) => React.createElement('CodeView', props),
}));

vi.mock('@/components/tools/shell/presentation/ToolHeaderActionsContext', () => ({
    ToolHeaderActionsContext: { Provider: ({ children }: any) => children },
}));

vi.mock('@/components/tools/renderers/system/StructuredResultView', () => ({
    StructuredResultView: () => React.createElement('StructuredResultView'),
}));

vi.mock('@/utils/errors/toolErrorParser', () => ({
    parseToolUseError: () => ({ isToolUseError: false }),
}));

vi.mock('@/components/tools/shell/presentation/ToolError', () => ({
    ToolError: () => React.createElement('ToolError'),
}));

vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: [],
    DEFAULT_AGENT_ID: 'claude',
    resolveAgentIdFromFlavor: () => null,
    getAgentCore: () => ({ toolRendering: { hideUnknownToolsByDefault: false } }),
}));

vi.mock('@/components/tools/shell/views/timeline/ToolTimelineRowHeader', () => ({
    ToolTimelineRowHeader: (props: any) => {
        capturedHeaderProps.push(props);
        return React.createElement('ToolTimelineRowHeader', props);
    },
}));

vi.mock('@/components/sessions/transcript/motion/TranscriptCollapsible', () => ({
    TranscriptCollapsible: ({ expanded, children }: any) =>
        React.createElement('TranscriptCollapsible', { expanded }, expanded ? children : null),
}));

vi.mock('../permissions/PermissionFooter', () => ({
    PermissionFooter: () => null,
}));

async function renderToolTimelineRow(overrides: Record<string, unknown> = {}) {
    const { ToolTimelineRow } = await import('./ToolTimelineRow');
    const tool = {
        name: 'read',
        state: 'completed',
        input: {},
        createdAt: 1,
        startedAt: 1,
        completedAt: 2,
        description: null,
        result: {},
        ...(overrides.tool as Record<string, unknown> | undefined),
    } as any;

    return renderScreen(
        <ToolTimelineRow
            tool={tool}
            metadata={null}
            {...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'tool'))}
        />,
    );
}

describe('ToolTimelineRow (disclosure)', () => {
    beforeEach(() => {
        capturedHeaderProps.length = 0;
        settings = {
            toolViewDetailLevelDefault: 'title',
            toolViewDetailLevelDefaultLocalControl: 'summary',
            toolViewDetailLevelByToolName: {},
            toolViewExpandedDetailLevelDefault: 'summary',
            toolViewExpandedDetailLevelByToolName: {},
            toolViewTimelineFeedDefaultExpanded: false,
            toolViewTapAction: 'expand',
            permissionPromptSurface: 'transcript',
        };
    });

    afterEach(() => {
        standardCleanup();
    });

    it('shows a persistent expanded disclosure after the user expands the row', async () => {
        const screen = await renderToolTimelineRow({
            sessionId: 's1',
            messageId: 'm1',
        });

        expect(capturedHeaderProps.at(-1)?.disclosure).toEqual({ behavior: 'hover', state: 'collapsed' });

        await act(async () => {
            screen.pressByTestId('tool-timeline-row');
        });

        expect(capturedHeaderProps.at(-1)?.disclosure).toEqual({ behavior: 'persistent', state: 'expanded' });
    });

    it('shows a persistent expanded disclosure for rows that start expanded by default', async () => {
        settings.toolViewTimelineFeedDefaultExpanded = true;

        await renderToolTimelineRow({
            sessionId: 's1',
            messageId: 'm1',
        });

        expect(capturedHeaderProps.at(-1)?.disclosure).toEqual({ behavior: 'persistent', state: 'expanded' });
    });
});
