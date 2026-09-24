import * as React from 'react';
import renderer from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
    sessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/settings/mcpServers/McpServersSettingsScreen', () => ({
    McpServersSettingsScreen: () => React.createElement('McpServersSettingsScreen'),
}));

installSessionSettingsEntryModuleMocks();

describe('MCP settings route (feature gate)', () => {
    afterEach(() => {
        standardCleanup();
        resetSessionSettingsEntryState();
    });

    it('returns null when no feature resolver is provided', async () => {
        const mod = await import('@/app/(app)/settings/mcp');
        const McpRoute = mod.default;

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(React.createElement(McpRoute))).tree;

        expect(tree.toJSON()).toBeNull();
    });

    it('returns null when mcp.servers feature is disabled', async () => {
        const useFeatureEnabledMock = vi.fn((featureId: string) => featureId !== 'mcp.servers');
        sessionSettingsEntryState.options.featureEnabled = useFeatureEnabledMock;

        const mod = await import('@/app/(app)/settings/mcp');
        const McpRoute = mod.default;

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(React.createElement(McpRoute))).tree;

        expect(tree.toJSON()).toBeNull();
        expect(useFeatureEnabledMock).toHaveBeenCalledWith('mcp.servers');
    });

    it('renders McpServersSettingsScreen when mcp.servers feature is enabled', async () => {
        const useFeatureEnabledMock = vi.fn((featureId: string) => featureId === 'mcp.servers');
        sessionSettingsEntryState.options.featureEnabled = useFeatureEnabledMock;

        const mod = await import('@/app/(app)/settings/mcp');
        const McpRoute = mod.default;

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(React.createElement(McpRoute))).tree;

        expect(tree.toJSON()).not.toBeNull();
        expect(useFeatureEnabledMock).toHaveBeenCalledWith('mcp.servers');
        const screen = tree.findByType('McpServersSettingsScreen' as any);
        expect(screen).toBeTruthy();
    });
});
