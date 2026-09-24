import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installToolShellPresentationCommonModuleMocks } from './toolShellPresentationTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const diffViewerSpy = vi.fn();
let wrapLinesSetting: boolean = true;
let inlineVirtualizationThresholdSetting: number | undefined = undefined;
let inlineVirtualizationByteThresholdSetting: number | undefined = undefined;
let reviewCommentsFeatureEnabled = false;

installToolShellPresentationCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: ((value: any) => value?.web ?? value?.default ?? null),
            },
            useWindowDimensions: (() => ({ width: 1024, height: 768, scale: 1, fontScale: 1 })),
        });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSetting: (key: string) => {
                if (key === 'wrapLinesInDiffs') return wrapLinesSetting;
                if (key === 'filesDiffInlineVirtualizationLineThreshold') return inlineVirtualizationThresholdSetting;
                if (key === 'filesDiffInlineVirtualizationByteThreshold') return inlineVirtualizationByteThresholdSetting;
                return undefined;
            },
        });
    },
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => featureId === 'files.reviewComments' && reviewCommentsFeatureEnabled,
}));

vi.mock('@/sync/domains/session/resolveWorkspaceScopeForSession', () => ({
    useWorkspaceScopeForSession: (sessionId: string | null | undefined) => (
        sessionId === 'session-1'
            ? { serverId: 'server-1', machineId: 'machine-1', rootPath: '/repo' }
            : null
    ),
}));

vi.mock('@/components/ui/code/diff/DiffViewer', () => ({
    DiffViewer: (props: any) => {
        diffViewerSpy(props);
        return React.createElement('DiffViewer', props);
    },
}));

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    }
    if (style && typeof style === 'object') {
        return style as Record<string, unknown>;
    }
    return {};
}

const toolDiffViewModule = import('./ToolDiffView');

describe('ToolDiffView', () => {
    beforeEach(() => {
        reviewCommentsFeatureEnabled = false;
        wrapLinesSetting = true;
        inlineVirtualizationThresholdSetting = undefined;
        inlineVirtualizationByteThresholdSetting = undefined;
        diffViewerSpy.mockClear();
    });

    it('plumbs filePath and wrapLines into DiffViewer', async () => {
        const { ToolDiffView } = await toolDiffViewModule;

        const screen = await renderScreen(React.createElement(ToolDiffView, {
                    filePath: 'src/foo.ts',
                    oldText: 'const x = 1;\n',
                    newText: 'const x = 2;\n',
                }));

        const rootView = screen.findAllByType('View' as any)[0];
        expect(flattenStyle(rootView.props.style).flex).toBeUndefined();
        expect(diffViewerSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                mode: 'text',
                filePath: 'src/foo.ts',
                wrapLines: true,
            }),
        );
    });

    it('passes wrapLines=false through to DiffViewer', async () => {
        wrapLinesSetting = false;
        const { ToolDiffView } = await toolDiffViewModule;

        await renderScreen(React.createElement(ToolDiffView, {
                    filePath: 'src/foo.ts',
                    oldText: 'const x = 1;\n',
                    newText: 'const x = 2;\n',
                }));

        expect(diffViewerSpy).toHaveBeenCalledWith(expect.objectContaining({ wrapLines: false }));
    });

    it('virtualizes large tool diffs to avoid rendering thousands of rows inline', async () => {
        inlineVirtualizationThresholdSetting = 400;
        const { ToolDiffView } = await toolDiffViewModule;

        const oldLines: string[] = [];
        const newLines: string[] = [];
        for (let i = 0; i < 900; i++) {
            oldLines.push(`const a${i} = ${i};`);
            newLines.push(`const a${i} = ${i + 1};`);
        }

        const screen = await renderScreen(React.createElement(ToolDiffView, {
                    filePath: 'src/huge.ts',
                    oldText: oldLines.join('\n') + '\n',
                    newText: newLines.join('\n') + '\n',
                }));

        expect(diffViewerSpy).toHaveBeenCalledWith(expect.objectContaining({ virtualized: true }));
        const rootView = screen.findAllByType('View' as any)[0];
        const rootStyle = flattenStyle(rootView.props.style);
        expect(rootStyle.height).toBe(rootStyle.maxHeight);
    });

    it('respects the inline virtualization threshold setting', async () => {
        inlineVirtualizationThresholdSetting = 2_000;
        inlineVirtualizationByteThresholdSetting = undefined;
        const { ToolDiffView } = await toolDiffViewModule;

        const oldLines: string[] = [];
        const newLines: string[] = [];
        for (let i = 0; i < 900; i++) {
            oldLines.push(`const a${i} = ${i};`);
            newLines.push(`const a${i} = ${i + 1};`);
        }

        await renderScreen(React.createElement(ToolDiffView, {
                    filePath: 'src/huge.ts',
                    oldText: oldLines.join('\n') + '\n',
                    newText: newLines.join('\n') + '\n',
                }));

        expect(diffViewerSpy).toHaveBeenCalledWith(expect.objectContaining({ virtualized: false }));
    });

    it('virtualizes diffs above the byte threshold even when line count is below the line threshold', async () => {
        inlineVirtualizationThresholdSetting = 50_000;
        inlineVirtualizationByteThresholdSetting = 100;
        const { ToolDiffView } = await toolDiffViewModule;

        await renderScreen(React.createElement(ToolDiffView, {
                    filePath: 'src/minified.js',
                    oldText: 'a'.repeat(2_000),
                    newText: 'b',
                }));

        expect(diffViewerSpy).toHaveBeenCalledWith(expect.objectContaining({ virtualized: true }));
    });

    it('forces unified presentation for creation/deletion diffs to avoid empty split columns', async () => {
        const { ToolDiffView } = await toolDiffViewModule;

        await renderScreen(React.createElement(ToolDiffView, {
                    filePath: 'src/new.ts',
                    oldText: '',
                    newText: 'export const x = 1;\n',
                }));

        expect(diffViewerSpy).toHaveBeenCalledWith(expect.objectContaining({ presentationStyleOverride: 'unified' }));
    });

    it('enables review comments for scoped transcript tool diffs with a file path', async () => {
        reviewCommentsFeatureEnabled = true;
        const { ToolDiffView } = await toolDiffViewModule;

        await renderScreen(React.createElement(ToolDiffView, {
                    sessionId: 'session-1',
                    filePath: 'src/foo.ts',
                    oldText: 'const x = 1;\n',
                    newText: 'const x = 2;\n',
                }));

        expect(diffViewerSpy).toHaveBeenCalledWith(expect.objectContaining({
            filePath: 'src/foo.ts',
            onPressLine: expect.any(Function),
            onPressLineRange: expect.any(Function),
            pressLineWhenNotSelectable: true,
            onPressAddComment: expect.any(Function),
            isCommentActive: expect.any(Function),
            renderAfterLine: expect.any(Function),
        }));
    });

    it('does not enable review comments when the tool diff has no file path', async () => {
        reviewCommentsFeatureEnabled = true;
        const { ToolDiffView } = await toolDiffViewModule;

        await renderScreen(React.createElement(ToolDiffView, {
                    sessionId: 'session-1',
                    oldText: 'const x = 1;\n',
                    newText: 'const x = 2;\n',
                }));

        expect(diffViewerSpy).toHaveBeenCalledWith(expect.objectContaining({
            onPressLine: undefined,
            onPressLineRange: undefined,
            pressLineWhenNotSelectable: false,
            onPressAddComment: undefined,
            isCommentActive: undefined,
            renderAfterLine: undefined,
        }));
    });
});
