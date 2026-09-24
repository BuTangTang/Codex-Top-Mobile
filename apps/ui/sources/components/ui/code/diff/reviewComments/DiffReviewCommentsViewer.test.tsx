import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installCodeDiffCommonModuleMocks } from '../codeDiffTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 120_000 };
let reviewCommentControls: any = null;
let intraLineDiffConfig = { enabled: false, maxLines: 0, maxLineLength: 0, maxPairs: 0 };
const diffViewerRenderSpy = vi.fn();

installCodeDiffCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Platform: {
                OS: 'ios',
                select: (options: any) => options?.ios ?? options?.default ?? options?.web ?? options?.android,
            },
            AppState: {
                addEventListener: () => ({ remove: () => {} }),
            },
        });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSetting: (key: string) => {
                if (key === 'wrapLinesInDiffs') return true;
                if (key === 'showLineNumbers') return true;
                return null;
            },
        });
    },
});

vi.mock('@/components/ui/code/diff/DiffViewer', () => ({
    DiffViewer: (props: any) => {
        diffViewerRenderSpy(props);
        return React.createElement('DiffViewer', props);
    },
}));

vi.mock('@/components/ui/code/diff/useInlineDiffVirtualizationThresholds', () => ({
    useInlineDiffVirtualizationThresholds: () => thresholds,
}));

vi.mock('@/components/sessions/reviews/comments/useCodeLinesReviewComments', () => ({
    useCodeLinesReviewComments: () => reviewCommentControls,
}));

vi.mock('@/components/ui/code/diff/useIntraLineWordDiffConfig', () => ({
    useIntraLineWordDiffConfig: () => intraLineDiffConfig,
}));

describe('DiffReviewCommentsViewer', () => {
    beforeEach(() => {
        reviewCommentControls = null;
        intraLineDiffConfig = { enabled: false, maxLines: 0, maxLineLength: 0, maxPairs: 0 };
        diffViewerRenderSpy.mockClear();
    });

    it('keeps non-virtual rendering for small diffs when review comments are enabled', async () => {
        thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 120_000 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={'a\nb\n'}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                />);

        const view = screen.findByType('DiffViewer' as any);
        expect(view.props.virtualized).toBe(false);
    });

    it('does not rebuild the diff viewer for equivalent parent rerenders', async () => {
        thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 120_000 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');
        const unifiedDiff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
        const reviewCommentDrafts: any[] = [];
        const onUpsertReviewCommentDraft = vi.fn();
        const onDeleteReviewCommentDraft = vi.fn();
        const onReviewCommentError = vi.fn();

        function Wrapper() {
            const [tick, setTick] = React.useState(0);
            return (
                <>
                    <DiffReviewCommentsViewer
                        filePath="src/a.ts"
                        unifiedDiff={unifiedDiff}
                        reviewCommentsEnabled={true}
                        reviewCommentDrafts={reviewCommentDrafts}
                        onUpsertReviewCommentDraft={onUpsertReviewCommentDraft}
                        onDeleteReviewCommentDraft={onDeleteReviewCommentDraft}
                        onReviewCommentError={onReviewCommentError}
                    />
                    {React.createElement('Pressable' as any, {
                        testID: 'parent-rerender',
                        onPress: () => setTick((value) => value + 1),
                        children: tick,
                    })}
                </>
            );
        }

        const screen = await renderScreen(<Wrapper />);
        expect(screen.findAllByType('DiffViewer' as any)).toHaveLength(1);
        expect(diffViewerRenderSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
            screen.pressByTestId('parent-rerender');
        });

        expect(screen.findAllByType('DiffViewer' as any)).toHaveLength(1);
        expect(diffViewerRenderSpy).toHaveBeenCalledTimes(1);
    });

    it('enables virtualization for large diffs when review comments are enabled', async () => {
        thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 100 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={'a'.repeat(2_000)}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                />);

        const view = screen.findByType('DiffViewer' as any);
        expect(view.props.virtualized).toBe(true);
    });

    it('hides inactive line comment affordances for virtualized review diffs', async () => {
        thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 100 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={'a'.repeat(2_000)}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                />);

        const view = screen.findByType('DiffViewer' as any);
        expect(view.props.virtualized).toBe(true);
        expect(view.props.showInactiveCommentAffordance).toBe(false);
    });

    it('hides inactive line comment affordances for non-virtualized native review diffs', async () => {
        thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 120_000 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={'a\nb\n'}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                />);

        const view = screen.findByType('DiffViewer' as any);
        expect(view.props.virtualized).toBe(false);
        expect(view.props.showInactiveCommentAffordance).toBe(false);
    });

    it('bounds large virtualized review diffs so native lists do not mount as unbounded content', async () => {
        thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 100 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={'a'.repeat(2_000)}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                />);

        const boundedContainers = screen.findAll((node) => (
            String(node.type) === 'View'
            && typeof node.props?.style?.maxHeight === 'number'
            && node.props.style.maxHeight > 0
        ));
        expect(boundedContainers).toHaveLength(1);
        expect(boundedContainers[0].props.style.height).toBe(boundedContainers[0].props.style.maxHeight);
    });

    it('plumbs display configuration into DiffViewer', async () => {
        thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 120_000 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={'a\nb\n'}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                    wrapLines={false}
                    showLineNumbers={true}
                    showPrefix={true}
                />);

        const view = screen.findByType('DiffViewer' as any);
        expect(view.props.wrapLines).toBe(false);
        expect(view.props.showLineNumbers).toBe(true);
        expect(view.props.showPrefix).toBe(true);
    });

    it('passes its parsed diff lines through to DiffViewer for reuse', async () => {
        thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 120_000 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n'}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                />);

        const view = screen.findByType('DiffViewer' as any);
        expect(view.props.precomputedLines).toEqual(expect.arrayContaining([
            expect.objectContaining({ renderCodeText: 'old' }),
            expect.objectContaining({ renderCodeText: 'new' }),
        ]));
    });

    it('uses the whole diff line and drag range as review comment targets when comments are enabled', async () => {
        thresholds = { lineThreshold: 50_000, reviewCommentsLineThreshold: 50_000, byteThreshold: 120_000 };
        const onPressAddComment = vi.fn();
        const onPressAddCommentRange = vi.fn();
        reviewCommentControls = {
            onPressAddComment,
            onPressAddCommentRange,
            isCommentActive: () => false,
            renderAfterLine: () => null,
        };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n'}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                />);

        const view = screen.findByType('DiffViewer' as any);
        expect(view.props.onPressLine).toBe(onPressAddComment);
        expect(view.props.onPressLineRange).toBe(onPressAddCommentRange);
        expect(view.props.pressLineWhenNotSelectable).toBe(true);
    });

    it('uses the lower review-comment threshold for medium comment-enabled diffs', async () => {
        thresholds = { lineThreshold: 400, reviewCommentsLineThreshold: 120, byteThreshold: 120_000 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');
        const mediumDiff = [
            'diff --git a/src/a.ts b/src/a.ts',
            '--- a/src/a.ts',
            '+++ b/src/a.ts',
            '@@ -1,80 +1,80 @@',
            ...Array.from({ length: 80 }, (_, index) => `-old ${index}`),
            ...Array.from({ length: 80 }, (_, index) => `+new ${index}`),
        ].join('\n');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={mediumDiff}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                />);

        const view = screen.findByType('DiffViewer' as any);
        expect(view.props.virtualized).toBe(true);
    });

    it('skips intra-line word diff work for virtualized review comment diffs', async () => {
        thresholds = { lineThreshold: 400, reviewCommentsLineThreshold: 4, byteThreshold: 120_000 };
        intraLineDiffConfig = { enabled: true, maxLines: 50_000, maxLineLength: 800, maxPairs: 500 };
        const { DiffReviewCommentsViewer } = await import('./DiffReviewCommentsViewer');

        const screen = await renderScreen(<DiffReviewCommentsViewer
                    filePath="src/a.ts"
                    unifiedDiff={'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old value\n+new value\n'}
                    reviewCommentsEnabled={true}
                    reviewCommentDrafts={[]}
                />);

        const view = screen.findByType('DiffViewer' as any);
        expect(view.props.virtualized).toBe(true);
        expect(view.props.precomputedLines).toEqual(expect.arrayContaining([
            expect.objectContaining({
                renderCodeText: 'old value',
                renderIntraLineDiffSegments: null,
            }),
            expect.objectContaining({
                renderCodeText: 'new value',
                renderIntraLineDiffSegments: null,
            }),
        ]));
    });
});
