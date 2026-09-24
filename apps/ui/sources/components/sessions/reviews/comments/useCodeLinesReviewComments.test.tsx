import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Pressable, Text, View } from 'react-native';
import { renderScreen } from '@/dev/testkit';
import { flattenTestStyle } from '@/dev/testkit/harness/popoverHarness';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit');
    return await createReactNativeWebMock({
        View: ({ children, ...props }: any) => React.createElement('View', props, children),
        Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
        Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
        TextInput: (props: any) => React.createElement('TextInput', props),
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit');
    return await createUnistylesMock({
        theme: {
            colors: {
                divider: '#333',
                surface: '#111',
                surfaceHighest: '#222',
                surfacePressed: '#444',
                text: '#eee',
                textSecondary: '#aaa',
                textDestructive: '#f00',
                button: {
                    primary: { background: '#fff', tint: '#000' },
                    secondary: { surface: '#222', tint: '#eee' },
                },
            },
        },
    });
});

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
    },
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    TextInput: 'TextInput',
}));

describe('useCodeLinesReviewComments', () => {
    it('toggles an inline composer after pressing add-comment for a line', async () => {
        const { useCodeLinesReviewComments } = await import('./useCodeLinesReviewComments');

        const lines = [
            {
                id: 'f:1',
                sourceIndex: 0,
                kind: 'file',
                oldLine: null,
                newLine: 1,
                renderPrefixText: '',
                renderCodeText: 'const a = 1;',
                renderIsHeaderLine: false,
                selectable: true,
            },
        ] as any;

        function Harness() {
            const controls = useCodeLinesReviewComments({
                enabled: true,
                filePath: 'src/a.ts',
                source: 'file',
                lines,
                drafts: [],
            });

            return (
                <React.Fragment>
                    <Pressable testID="add-comment-trigger" onPress={() => controls!.onPressAddComment(lines[0])} />
                    <Text>{controls!.isCommentActive(lines[0]) ? 'active' : 'inactive'}</Text>
                    {controls!.renderAfterLine(lines[0])}
                </React.Fragment>
            );
        }

        const screen = await renderScreen(<Harness />);

        expect(screen.findByTestId('add-comment-trigger')).toBeTruthy();
        expect(screen.findAllByType('TextInput' as any)).toHaveLength(0);
        const statusBefore = screen.findAllByType('Text' as any).map((n) => n.props.children).join(' ');
        expect(statusBefore).toContain('inactive');

        await act(async () => {
            await screen.pressByTestIdAsync('add-comment-trigger');
        });

        const statusAfter = screen.findAllByType('Text' as any).map((n) => n.props.children).join(' ');
        expect(statusAfter).toContain('active');
        const inputs = screen.findAllByType('TextInput' as any);
        expect(inputs).toHaveLength(1);
        expect(inputs[0]!.props.placeholder).toBe('Add a review comment…');
        expect(flattenTestStyle(inputs[0]!.props.style)).toMatchObject({
            outline: 'none',
            outlineStyle: 'none',
            outlineWidth: 0,
            outlineColor: 'transparent',
            boxShadow: 'none',
        });
    });

    it('opens a range composer after the final selected line', async () => {
        const { useCodeLinesReviewComments } = await import('./useCodeLinesReviewComments');

        const lines = [
            {
                id: 'f:1',
                sourceIndex: 0,
                kind: 'file',
                oldLine: null,
                newLine: 1,
                renderPrefixText: '',
                renderCodeText: 'const first = 1;',
                renderIsHeaderLine: false,
                selectable: true,
            },
            {
                id: 'f:2',
                sourceIndex: 1,
                kind: 'file',
                oldLine: null,
                newLine: 2,
                renderPrefixText: '',
                renderCodeText: 'const second = 2;',
                renderIsHeaderLine: false,
                selectable: true,
            },
        ] as any;

        function Harness() {
            const controls = useCodeLinesReviewComments({
                enabled: true,
                filePath: 'src/a.ts',
                source: 'file',
                lines,
                drafts: [],
            });

            return (
                <React.Fragment>
                    <Pressable testID="add-range-comment-trigger" onPress={() => controls!.onPressAddCommentRange([lines[0], lines[1]])} />
                    <View testID="first-line">{controls!.renderAfterLine(lines[0])}</View>
                    <View testID="second-line">{controls!.renderAfterLine(lines[1])}</View>
                </React.Fragment>
            );
        }

        const screen = await renderScreen(<Harness />);

        await act(async () => {
            await screen.pressByTestIdAsync('add-range-comment-trigger');
        });

        const firstLine = screen.findByTestId('first-line');
        const secondLine = screen.findByTestId('second-line');
        if (!firstLine || !secondLine) throw new Error('Expected rendered line containers');

        expect(firstLine.findAllByType('TextInput' as any)).toHaveLength(0);
        expect(secondLine.findAllByType('TextInput' as any)).toHaveLength(1);
    });

    it('renders an existing draft on a moved file line by matching the stored line hash', async () => {
        const { useCodeLinesReviewComments } = await import('./useCodeLinesReviewComments');
        const { computeLineContentHash } = await import('@/utils/text/lineContentHash');

        const lines = [
            {
                id: 'f:1',
                sourceIndex: 0,
                kind: 'file',
                oldLine: null,
                newLine: 1,
                renderPrefixText: '',
                renderCodeText: 'const inserted = true;',
                renderIsHeaderLine: false,
                selectable: true,
            },
            {
                id: 'f:2',
                sourceIndex: 1,
                kind: 'file',
                oldLine: null,
                newLine: 2,
                renderPrefixText: '',
                renderCodeText: 'const moved = 2;  ',
                renderIsHeaderLine: false,
                selectable: true,
            },
        ] as any;

        function Harness() {
            const controls = useCodeLinesReviewComments({
                enabled: true,
                filePath: 'src/a.ts',
                source: 'file',
                lines,
                drafts: [{
                    id: 'draft-1',
                    filePath: 'src/a.ts',
                    source: 'file',
                    anchor: {
                        kind: 'fileLine',
                        startLine: 1,
                        lineHash: computeLineContentHash('const moved = 2;  '),
                    },
                    snapshot: {
                        selectedLines: ['const moved = 2;'],
                        beforeContext: [],
                        afterContext: [],
                    },
                    body: 'Keep the moved line anchored.',
                    createdAt: 1,
                }],
            });

            return (
                <React.Fragment>
                    <View testID="first-line">{controls!.renderAfterLine(lines[0])}</View>
                    <View testID="second-line">{controls!.renderAfterLine(lines[1])}</View>
                </React.Fragment>
            );
        }

        const screen = await renderScreen(<Harness />);

        const firstLine = screen.findByTestId('first-line');
        const secondLine = screen.findByTestId('second-line');
        if (!firstLine || !secondLine) {
            throw new Error('Expected review comment line containers to render');
        }
        const firstLineText = firstLine.findAllByType('Text' as any).map((n) => n.props.children).join(' ');
        const secondLineText = secondLine.findAllByType('Text' as any).map((n) => n.props.children).join(' ');

        expect(firstLineText).not.toContain('Keep the moved line anchored.');
        expect(secondLineText).toContain('Keep the moved line anchored.');
    });

    it('renders an existing normalized range draft at the first resolved range line', async () => {
        const { useCodeLinesReviewComments } = await import('./useCodeLinesReviewComments');

        const lines = [
            {
                id: 'f:1',
                sourceIndex: 0,
                kind: 'file',
                oldLine: null,
                newLine: 1,
                renderPrefixText: '',
                renderCodeText: 'const first = 1;',
                renderIsHeaderLine: false,
                selectable: true,
            },
            {
                id: 'f:2',
                sourceIndex: 1,
                kind: 'file',
                oldLine: null,
                newLine: 2,
                renderPrefixText: '',
                renderCodeText: 'const second = 2;',
                renderIsHeaderLine: false,
                selectable: true,
            },
        ] as any;

        function Harness() {
            const controls = useCodeLinesReviewComments({
                enabled: true,
                filePath: 'src/a.ts',
                source: 'file',
                lines,
                drafts: [{
                    id: 'draft-1',
                    filePath: 'src/a.ts',
                    source: 'file',
                    anchor: {
                        kind: 'range',
                        filePath: 'src/a.ts',
                        startLine: 1,
                        endLine: 2,
                    },
                    snapshot: {
                        selectedLines: ['const first = 1;', 'const second = 2;'],
                        beforeContext: [],
                        afterContext: [],
                    },
                    body: 'Review the whole range.',
                    createdAt: 1,
                }],
            });

            return (
                <React.Fragment>
                    <View testID="first-line">{controls!.renderAfterLine(lines[0])}</View>
                    <View testID="second-line">{controls!.renderAfterLine(lines[1])}</View>
                </React.Fragment>
            );
        }

        const screen = await renderScreen(<Harness />);

        const firstLine = screen.findByTestId('first-line');
        const secondLine = screen.findByTestId('second-line');
        if (!firstLine || !secondLine) throw new Error('Expected rendered line containers');

        const firstLineText = firstLine.findAllByType('Text' as any).map((n) => n.props.children).join(' ');
        const secondLineText = secondLine.findAllByType('Text' as any).map((n) => n.props.children).join(' ');

        expect(firstLineText).toContain('Review the whole range.');
        expect(secondLineText).not.toContain('Review the whole range.');
    });

    it('renders saved comments flush with the diff body and lets users edit them', async () => {
        const { useCodeLinesReviewComments } = await import('./useCodeLinesReviewComments');

        const lines = [
            {
                id: 'f:1',
                sourceIndex: 0,
                kind: 'file',
                oldLine: null,
                newLine: 1,
                renderPrefixText: '',
                renderCodeText: 'const secret = "old";',
                renderIsHeaderLine: false,
                selectable: true,
            },
        ] as any;

        function Harness() {
            const controls = useCodeLinesReviewComments({
                enabled: true,
                filePath: 'src/a.ts',
                source: 'file',
                lines,
                drafts: [{
                    id: 'draft-1',
                    filePath: 'src/a.ts',
                    source: 'file',
                    anchor: {
                        kind: 'fileLine',
                        startLine: 1,
                    },
                    snapshot: {
                        selectedLines: ['const secret = "old";'],
                        beforeContext: [],
                        afterContext: [],
                    },
                    body: 'Update the secret handling.',
                    createdAt: 1,
                }],
            });

            return <View testID="line">{controls!.renderAfterLine(lines[0])}</View>;
        }

        const screen = await renderScreen(<Harness />);

        const savedContainer = screen.findByTestId('review-comment-saved-drafts:f:1');
        if (!savedContainer) {
            throw new Error('Expected saved review comment container');
        }
        expect(flattenTestStyle(savedContainer.props.style).marginLeft ?? 0).toBe(0);

        await act(async () => {
            await screen.pressByTestIdAsync('review-comment-draft-edit:draft-1');
        });

        const inputs = screen.findAllByType('TextInput' as any);
        expect(inputs).toHaveLength(1);
        expect(inputs[0]!.props.value).toBe('Update the secret handling.');
    });

    it('preserves an existing range anchor when editing a saved range comment', async () => {
        const { useCodeLinesReviewComments } = await import('./useCodeLinesReviewComments');
        const onUpsertDraft = vi.fn();

        const lines = [
            {
                id: 'f:1',
                sourceIndex: 0,
                kind: 'file',
                oldLine: null,
                newLine: 1,
                renderPrefixText: '',
                renderCodeText: 'const first = 1;',
                renderIsHeaderLine: false,
                selectable: true,
            },
            {
                id: 'f:2',
                sourceIndex: 1,
                kind: 'file',
                oldLine: null,
                newLine: 2,
                renderPrefixText: '',
                renderCodeText: 'const second = 2;',
                renderIsHeaderLine: false,
                selectable: true,
            },
        ] as any;

        function Harness() {
            const controls = useCodeLinesReviewComments({
                enabled: true,
                filePath: 'src/a.ts',
                source: 'file',
                lines,
                drafts: [{
                    id: 'draft-range',
                    filePath: 'src/a.ts',
                    source: 'file',
                    anchor: {
                        kind: 'range',
                        filePath: 'src/a.ts',
                        startLine: 1,
                        endLine: 2,
                    },
                    snapshot: {
                        selectedLines: ['const first = 1;', 'const second = 2;'],
                        beforeContext: [],
                        afterContext: [],
                    },
                    body: 'Review the range.',
                    createdAt: 1,
                }],
                onUpsertDraft,
            });

            return <View testID="line">{controls!.renderAfterLine(lines[0])}</View>;
        }

        const screen = await renderScreen(<Harness />);

        await act(async () => {
            await screen.pressByTestIdAsync('review-comment-draft-edit:draft-range');
        });

        const input = screen.findAllByType('TextInput' as any)[0];
        await act(async () => {
            input!.props.onChangeText('Review the range again.');
        });

        const saveButton = screen.findAllByType('Pressable' as any).find((node) => {
            const text = node.findAllByType('Text' as any).map((child) => child.props.children).join(' ');
            return text.includes('Save');
        });
        if (!saveButton) throw new Error('Expected save button');

        await act(async () => {
            saveButton.props.onPress();
        });

        expect(onUpsertDraft).toHaveBeenCalledWith(expect.objectContaining({
            id: 'draft-range',
            createdAt: 1,
            body: 'Review the range again.',
            anchor: expect.objectContaining({
                kind: 'range',
                startLine: 1,
                endLine: 2,
            }),
        }));
    });
});
