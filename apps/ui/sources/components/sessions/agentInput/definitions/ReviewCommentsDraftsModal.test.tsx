import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

import type { ReviewCommentDraft } from '@/sync/domains/input/reviewComments/reviewCommentTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: ({ children, ...props }: any) => React.createElement('View', props, children),
        ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
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
                button: {
                    primary: { background: '#fff', tint: '#000' },
                },
                divider: '#333',
                surface: '#111',
                surfaceHigh: '#1a1a1a',
                text: '#eee',
                textSecondary: '#aaa',
                textDestructive: '#f00',
            },
        },
    });
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

const routerPushSpy = vi.hoisted(() => vi.fn());
const resolveReviewCommentDraftAnchorsForPromptSpy = vi.hoisted(() => vi.fn(async (params: { drafts: unknown[] }) => params.drafts));

vi.mock('expo-router', () => ({
    usePathname: () => '/session/s1',
    useRouter: () => ({ push: routerPushSpy }),
}));

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        mono: () => ({}),
    },
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    TextInput: (props: any) => React.createElement('TextInput', props),
}));

vi.mock('@/sync/domains/state/storage', () => ({
    storage: {
        getState: () => ({
            upsertSessionReviewCommentDraft: vi.fn(),
            deleteSessionReviewCommentDraft: vi.fn(),
        }),
    },
}));

vi.mock('@/components/sessions/reviews/comments/resolveReviewCommentDraftAnchorsForPrompt', () => ({
    resolveReviewCommentDraftAnchorsForPrompt: (params: { drafts: unknown[] }) => resolveReviewCommentDraftAnchorsForPromptSpy(params),
}));

function isReviewCommentDraft(value: unknown): value is ReviewCommentDraft {
    return !!value
        && typeof value === 'object'
        && typeof (value as { id?: unknown }).id === 'string'
        && typeof (value as { filePath?: unknown }).filePath === 'string'
        && !!(value as { anchor?: unknown }).anchor
        && !!(value as { snapshot?: unknown }).snapshot;
}

describe('ReviewCommentsDraftsModal', () => {
    afterEach(() => {
        routerPushSpy.mockReset();
        resolveReviewCommentDraftAnchorsForPromptSpy.mockReset();
        resolveReviewCommentDraftAnchorsForPromptSpy.mockImplementation(async ({ drafts }: { drafts: unknown[] }) => drafts);
    });

    it('places the editable comment at the anchored line inside the context preview', async () => {
        const { ReviewCommentsDraftsModal } = await import('./ReviewCommentsDraftsModal');

        const draft = {
            id: 'draft-1',
            filePath: 'src/middleware/requestId.test.ts',
            source: 'diff',
            anchor: {
                kind: 'diffLine',
                side: 'after',
                startLine: 8,
                newLine: 8,
                oldLine: null,
                lineHash: 'lh1:test',
            },
            snapshot: {
                beforeContext: [
                    "+import { handleAppError } from '../lib/errors.js';",
                    '+',
                ],
                selectedLines: [
                    "+process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-chars';",
                ],
                afterContext: [
                    '+',
                    "+let requestId: typeof import('./requestId.js').requestId;",
                ],
            },
            body: 'change this',
            createdAt: 1,
        } satisfies ReviewCommentDraft;

        const screen = await renderScreen(
            <ReviewCommentsDraftsModal
                onClose={() => {}}
                sessionId="s1"
                reviewCommentDrafts={[draft]}
                onUpdateDraft={() => {}}
                onDeleteDraft={() => {}}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        const selectedLineIndex = serialized.indexOf("JWT_SECRET = 'test-secret");
        const commentIndex = serialized.indexOf('change this');
        const followingContextIndex = serialized.indexOf('requestId.js');

        expect(selectedLineIndex).toBeGreaterThanOrEqual(0);
        expect(commentIndex).toBeGreaterThan(selectedLineIndex);
        expect(followingContextIndex).toBeGreaterThan(commentIndex);
    });

    it('does not persist blank comment bodies and deletes blank drafts on close', async () => {
        const { ReviewCommentsDraftsModal } = await import('./ReviewCommentsDraftsModal');
        const onUpdateDraft = vi.fn();
        const onDeleteDraft = vi.fn();
        const draft = {
            id: 'draft-1',
            filePath: 'src/middleware/requestId.test.ts',
            source: 'diff',
            anchor: {
                kind: 'diffLine',
                side: 'after',
                startLine: 8,
                newLine: 8,
                oldLine: null,
                lineHash: 'lh1:test',
            },
            snapshot: {
                beforeContext: ['+before'],
                selectedLines: ['+selected'],
                afterContext: ['+after'],
            },
            body: 'keep me',
            createdAt: 1,
        } satisfies ReviewCommentDraft;

        const screen = await renderScreen(
            <ReviewCommentsDraftsModal
                onClose={() => {}}
                sessionId="s1"
                reviewCommentDrafts={[draft]}
                onUpdateDraft={onUpdateDraft}
                onDeleteDraft={onDeleteDraft}
            />,
        );

        const input = screen.findByTestId('review-comment-draft-body:draft-1');
        await act(async () => {
            input?.props.onChangeText('   ');
        });
        await screen.pressByTestIdAsync('review-comments-drafts-modal-done');

        expect(onUpdateDraft).not.toHaveBeenCalled();
        expect(onDeleteDraft).toHaveBeenCalledWith('draft-1');
    });

    it('navigates to the anchored file when jumping to a review comment file', async () => {
        const { ReviewCommentsDraftsModal } = await import('./ReviewCommentsDraftsModal');
        const draft = {
            id: 'draft-1',
            filePath: 'src/middleware/requestId.test.ts',
            source: 'diff',
            anchor: {
                kind: 'diffLine',
                side: 'after',
                startLine: 8,
                newLine: 8,
                oldLine: null,
                lineHash: 'lh1:test',
            },
            snapshot: {
                beforeContext: ['+before'],
                selectedLines: ['+selected'],
                afterContext: ['+after'],
            },
            body: 'change this',
            createdAt: 1,
        } satisfies ReviewCommentDraft;

        const screen = await renderScreen(
            <ReviewCommentsDraftsModal
                onClose={() => {}}
                sessionId="s1"
                reviewCommentDrafts={[draft]}
                onUpdateDraft={() => {}}
                onDeleteDraft={() => {}}
            />,
        );

        await screen.pressByTestIdAsync('review-comment-draft-jump:draft-1');

        expect(routerPushSpy).toHaveBeenCalledWith('/session/s1/file?path=src%2Fmiddleware%2FrequestId.test.ts&source=diff&anchor=diffLine&startLine=8&side=after&newLine=8&lineHash=lh1%3Atest');
    });

    it('refreshes draft previews with daemon anchor resolutions when a workspace scope is available', async () => {
        const { ReviewCommentsDraftsModal } = await import('./ReviewCommentsDraftsModal');
        const draft = {
            id: 'draft-1',
            filePath: 'src/middleware/requestId.test.ts',
            source: 'file',
            anchor: {
                kind: 'line',
                filePath: 'src/middleware/requestId.test.ts',
                line: 8,
                lineHash: 'lh1:1234567890abcdef',
            },
            snapshot: {
                beforeContext: [],
                selectedLines: ['const original = true;'],
                afterContext: [],
            },
            body: 'change this',
            createdAt: 1,
        } satisfies ReviewCommentDraft;
        resolveReviewCommentDraftAnchorsForPromptSpy.mockImplementation(async (params: { drafts: unknown[] }) => params.drafts.map((candidate) => {
            if (!isReviewCommentDraft(candidate)) return candidate;
            return {
            ...candidate,
            anchorResolution: {
                id: candidate.id,
                filePath: candidate.filePath,
                originalAnchor: candidate.anchor,
                resolvedAnchor: {
                    kind: 'line',
                    filePath: candidate.filePath,
                    line: 12,
                    lineHash: 'lh1:fedcba0987654321' as const,
                },
                status: 'hash',
                confidence: 0.85,
                preview: {
                    beforeContext: ['const before = true;'],
                    selectedLines: ['const moved = true;'],
                    afterContext: ['const after = true;'],
                },
            },
            };
        }));

        const screen = await renderScreen(
            <ReviewCommentsDraftsModal
                onClose={() => {}}
                sessionId="s1"
                reviewScope={{
                    serverId: 'server-1',
                    machineId: 'machine-1',
                    rootPath: '/repo',
                }}
                reviewCommentDrafts={[draft]}
                onUpdateDraft={() => {}}
                onDeleteDraft={() => {}}
            />,
        );

        await act(async () => {});

        expect(resolveReviewCommentDraftAnchorsForPromptSpy).toHaveBeenCalledWith(expect.objectContaining({
            reviewScope: {
                serverId: 'server-1',
                machineId: 'machine-1',
                rootPath: '/repo',
            },
        }));
        expect(JSON.stringify(screen.tree.toJSON())).toContain('const moved = true;');
    });
});
