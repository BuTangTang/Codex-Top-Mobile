/**
 * Identity-stability contract for the M8 transcript items pipeline.
 *
 * ChatList passes fresh deps object literals during normal renders. The pipeline
 * must keep stable callbacks and stable derived arrays when individual fields are
 * unchanged.
 */
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createSessionFixture, createToolCallMessageFixture, renderHook } from '@/dev/testkit';
import type { ChatTranscriptListItem } from '@/components/sessions/transcript/chatListTypes';
import type { Message } from '@/sync/domains/messages/messageTypes';
import type { ForkedTranscriptSnapshot } from '@/sync/domains/sessionFork/forkedTranscriptSnapshot';
import { useChatListRootState } from '@/components/sessions/transcript/useChatListRootState';

import { useTranscriptItemsPipeline, useTranscriptToolAutoExpandEffect } from './useTranscriptItemsPipeline';

type ItemsPipelineDeps = Parameters<typeof useTranscriptItemsPipeline>[0];

const rootPermissionState = vi.hoisted(() => ({
    messages: {} as Record<string, Message>,
    transcript: { ids: ['ordinary', 'pending'], isLoaded: true },
    width: 390,
    fork: null as ForkedTranscriptSnapshot | null,
    pendingMessages: { messages: [], discarded: [] },
    actionDrafts: [],
}));

// 根列表测试只替换已有平台/存储边界，保留真实分组缓存和投影链路。
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
        useWindowDimensions: () => ({ width: rootPermissionState.width, height: 844, scale: 1, fontScale: 1 }),
    });
});

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub, createUseSettingMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useForkedTranscriptSnapshot: () => rootPermissionState.fork,
        useSessionPendingMessages: () => rootPermissionState.pendingMessages,
        useSessionActionDrafts: () => rootPermissionState.actionDrafts,
        useSessionLatestThinkingMessageId: () => null,
        useSessionLatestThinkingMessageActivityAtMs: () => null,
        useSessionTranscriptIds: () => rootPermissionState.transcript,
        useSessionMessagesById: () => rootPermissionState.messages,
        useSetting: createUseSettingMock({ values: {
            transcriptGroupingMode: 'linear',
            transcriptGroupToolCalls: true,
            toolViewTimelineChromeMode: 'activity_feed',
            transcriptToolCallsCollapsedPreviewCount: 0,
            permissionPromptSurface: 'transcript',
        } }),
    });
});

function createRef<T>(current: T): { current: T } {
    return { current };
}

const inactiveWindowState = {
    activatedAtMs: null,
    hasMoreNewer: null,
    hasMoreOlder: null,
    isWindowMode: false,
    newerCursor: null,
    olderCursor: null,
    targetSeq: null,
    windowId: null,
    windowMaxSeq: null,
    windowMinSeq: null,
};

function createStableMembers() {
    const items = [
        { id: 'm1', kind: 'message' as const, messageId: 'm1', seq: 1, createdAt: 1 },
        { id: 'm2', kind: 'message' as const, messageId: 'm2', seq: 2, createdAt: 2 },
    ];
    return {
        activeTargetWindowTargetRef: createRef(null),
        canonicalWindowedItemsRef: createRef(items),
        entrySliceWindowRef: createRef(null),
        entrySliceWithheldCountRef: createRef(0),
        expandedToolCallsAnchorMessageIds: new Set<string>(),
        getMessageById: vi.fn((messageId: string) => ({
            id: messageId,
            kind: 'user',
            seq: messageId === 'm2' ? 2 : 1,
        })),
        getMessageRevisionById: vi.fn(() => 1),
        items,
        itemsRef: createRef(items),
        listDataRef: createRef(items),
        messagesById: {},
        preDecompositionItemsRef: createRef(items),
        renderWindowIndexMapRef: createRef(null),
        resolveThinkingExpanded: vi.fn(() => false),
        setEntrySliceWindow: vi.fn(),
        targetWindowActiveRef: createRef(false),
        webHotColdCountsRef: createRef({ coldCount: 0, hotCount: 0 }),
        wrapTranscriptItemForAnchor: vi.fn((_: unknown, node: React.ReactNode) => node),
    };
}

function buildDeps(members: ReturnType<typeof createStableMembers>): ItemsPipelineDeps {
    return {
        ...members,
        activeThinkingMessageId: null,
        committedMessagesCount: 2,
        entrySliceWindow: null,
        forkMessageMetadataById: null,
        groupingMode: 'linear',
        isLoaded: true,
        jumpToSeq: null,
        latestCommittedActivityKey: 'm2',
        listOrientation: 'standard',
        platformOS: 'web',
        rendererKind: 'legendList',
        rowFontScaleKey: 'default',
        rowWidthBucket: 'w',
        sessionActive: true,
        sessionId: 's1',
        sessionThinking: false,
        targetWindowState: inactiveWindowState,
        transcriptNativeHotTailItemCount: 0,
        transcriptToolCallsCollapsedPreviewCountSetting: 3,
        transcriptWebHotTailItemCount: 0,
    } as unknown as ItemsPipelineDeps;
}

describe('useTranscriptItemsPipeline identity stability', () => {
    // 复用真实根分组缓存，验证同一消息的审批状态变化仍会刷新可见工具行。
    it('refreshes compact permission visibility through the root when linear group items retain their identity', async () => {
        const ordinary = createToolCallMessageFixture({ id: 'ordinary', createdAt: 1 });
        const pending = createToolCallMessageFixture({ id: 'pending', createdAt: 2 });
        pending.tool = { ...pending.tool, permission: { id: 'p1', status: 'pending' } };
        rootPermissionState.messages = { ordinary, pending };
        rootPermissionState.width = 390;
        rootPermissionState.fork = null;
        const base = buildDeps(createStableMembers());
        const getMessageById = (id: string) => rootPermissionState.messages[id] ?? null;
        const session = createSessionFixture({ id: 'compact-permission-root', active: true });
        const hook = await renderHook((currentSession: typeof session) => {
            const root = useChatListRootState({ session: currentSession });
            const pipeline = useTranscriptItemsPipeline({
                ...base,
                ...root.internalProps,
                compactToolCalls: root.internalProps.toolChromeCommon.compactToolCalls,
                transcriptToolCallsCollapsedPreviewCountSetting: root.internalProps.toolChromeCommon.transcriptToolCallsCollapsedPreviewCount,
                getMessageById,
            });
            return { root, pipeline };
        }, { initialProps: session });
        const originalItems = hook.getCurrent().root.internalProps.items;
        const visibleTools = () => hook.getCurrent().pipeline.decomposedItems.flatMap((item) => item.kind === 'tool-group-tool' ? [item.toolMessageId] : []);
        expect(visibleTools()).toEqual(['pending']);
        const originalPendingIds = hook.getCurrent().root.internalProps.compactPendingToolCallIds;
        const originalProjection = hook.getCurrent().pipeline.decomposedItems;
        rootPermissionState.messages = { ordinary: { ...ordinary, tool: { ...ordinary.tool, description: 'updated output' } }, pending };
        await hook.rerender(session);
        expect(hook.getCurrent().root.internalProps.compactPendingToolCallIds).toBe(originalPendingIds);
        expect(hook.getCurrent().pipeline.decomposedItems).toBe(originalProjection);
        for (const status of ['approved', 'denied', 'canceled'] as const) {
            rootPermissionState.messages.pending = { ...pending, tool: { ...pending.tool, permission: { id: 'p1', status } } };
            await hook.rerender(session);
            expect(hook.getCurrent().root.internalProps.items).toBe(originalItems);
            expect(visibleTools()).toEqual([]);
        }
        rootPermissionState.messages.pending = { ...pending, tool: { ...pending.tool, state: 'completed' } };
        await hook.rerender(session);
        expect(visibleTools()).toEqual([]);
        rootPermissionState.messages = { ordinary, pending };
        await hook.rerender(session);
        expect(visibleTools()).toEqual(['pending']);
        await hook.rerender({ ...session, accessLevel: 'view', canApprovePermissions: false });
        expect(visibleTools()).toEqual([]);
        await hook.rerender({ ...session, active: false });
        expect(visibleTools()).toEqual([]);
        rootPermissionState.width = 1024;
        await hook.rerender(session);
        expect(visibleTools()).toEqual([]);
        rootPermissionState.width = 390;
        rootPermissionState.fork = {
            segments: [{ sessionId: 'parent', isReadOnlyContext: true, cutoffSeqInclusive: 2, messageIdsOldestFirst: ['ordinary', 'pending'], isHistoryStartLoaded: true }],
            combinedMessageIdsOldestFirst: ['ordinary', 'pending'],
            combinedMessagesById: { ordinary, pending },
            messageOriginById: { pending: { sessionId: 'parent', isReadOnlyContext: true } },
            isLoaded: true,
        };
        await hook.rerender(session);
        expect(visibleTools()).toEqual([]);
        rootPermissionState.fork = null;
        rootPermissionState.messages = { ordinary, pending: { ...pending, tool: { ...pending.tool, name: 'AskUserQuestion', permission: { id: 'p1', kind: 'user_action', status: 'pending' } } } };
        await hook.rerender(session);
        expect(visibleTools()).toEqual([]);
        expect(hook.getCurrent().pipeline.decomposedItems.some((item) => item.kind === 'message' && item.messageId === 'pending')).toBe(true);
        await hook.unmount();
    });

    // 待审批行必须穿过手机的零预览投影，审批结束后不改变组标识或展开状态。
    it('consumes compact permission visibility without changing tool IDs or expansion ownership', async () => {
        const ordinary = createToolCallMessageFixture({ id: 'ordinary', createdAt: 1 });
        const pending = createToolCallMessageFixture({ id: 'pending', createdAt: 2 });
        pending.tool = { ...pending.tool, state: 'running', permission: { id: 'p1', kind: 'permission', status: 'pending' } };
        const messages = { ordinary, pending };
        const deps: ItemsPipelineDeps = {
            ...buildDeps(createStableMembers()),
            items: [{ kind: 'tool-calls-group' as const, id: 'group-1', toolMessageIds: ['ordinary', 'pending'], createdAt: 1 }],
            messagesById: messages,
            getMessageById: undefined,
            compactToolCalls: true,
            compactPendingToolCallIds: ['pending'],
            transcriptToolCallsCollapsedPreviewCountSetting: 0,
        };
        const hook = await renderHook(useTranscriptItemsPipeline, { initialProps: deps });
        const rowIds = () => hook.getCurrent().decomposedItems.map((item) => item.id);
        expect(rowIds()).toEqual(['group-1#header', 'group-1#tool:pending', 'group-1#footer']);
        await hook.rerender({ ...deps, expandedToolCallsAnchorMessageIds: new Set(['ordinary']) });
        expect(rowIds()).toEqual(['group-1#header', 'group-1#tool:ordinary', 'group-1#tool:pending', 'group-1#footer']);
        await hook.rerender({ ...deps, compactPendingToolCallIds: [] });
        expect(rowIds()).toEqual(['group-1#header', 'group-1#footer']);
        await hook.rerender({ ...deps, forkMessageMetadataById: { pending: { originSessionId: 'parent', isReadOnlyContext: true } } });
        expect(rowIds()).toEqual(['group-1#header', 'group-1#footer']);
        await hook.rerender({ ...deps, compactToolCalls: false });
        expect(rowIds()).toEqual(['group-1#header', 'group-1#expand', 'group-1#footer']);
        await hook.unmount();
    });

    // 验证手机摘要只有一个操作入口，展开后仍恢复原始工具详情行。
    it('keeps compact tool groups collapsed to their header and restores tools on manual expansion', async () => {
        const tool = createToolCallMessageFixture({ id: 'tool-1', createdAt: 1 });
        const items: ChatTranscriptListItem[] = [{ kind: 'tool-calls-group', id: 'group-1', toolMessageIds: [tool.id], createdAt: 1 }];
        const deps: ItemsPipelineDeps = {
            ...buildDeps(createStableMembers()),
            items,
            getMessageById: () => tool,
            compactToolCalls: true,
            transcriptToolCallsCollapsedPreviewCountSetting: 0,
        };
        const hook = await renderHook(useTranscriptItemsPipeline, { initialProps: deps });

        expect(hook.getCurrent().decomposedItems.map((item) => item.kind)).toEqual(['tool-group-header', 'tool-group-footer']);
        await hook.rerender({ ...deps, expandedToolCallsAnchorMessageIds: new Set([tool.id]) });
        expect(hook.getCurrent().decomposedItems.map((item) => item.kind)).toEqual(['tool-group-header', 'tool-group-tool', 'tool-group-footer']);
        await hook.rerender({ ...deps, compactToolCalls: false });
        expect(hook.getCurrent().decomposedItems.map((item) => item.kind)).toEqual(['tool-group-header', 'tool-group-expand', 'tool-group-footer']);
        await hook.unmount();
    });

    // 短记录自动填充不能覆盖手机的默认折叠，其他布局仍保留旧行为。
    it.each([true, false])('auto-expands short groups only outside compact mode (%s)', async (compactToolCalls) => {
        const expanded = new Set<string>();
        const hook = await renderHook(() => useTranscriptToolAutoExpandEffect({
            compactToolCalls,
            applyToolCallsGroupExpanded: (request) => request.toolMessageIds.forEach((id) => expanded.add(id)),
            expandedToolCallsAnchorMessageIds: expanded,
            hasAutoExpandedToolCallsGroups: () => false,
            isScrollable: () => false,
            jumpToSeq: null,
            markAutoExpandedToolCallsGroups: () => {},
            maxTurnEntriesPerListItem: 4,
            pinToBottom: () => {},
            preDecompositionItemsRef: { current: [{ kind: 'tool-calls-group', id: 'group-1', toolMessageIds: ['tool-1'], createdAt: 1 }] },
            sessionEntryViewportRef: { current: { shouldFollowBottom: true } },
            sessionId: 's1',
            transcriptToolCallsCollapsedPreviewCountSetting: 0,
        }));
        expect([...expanded]).toEqual(compactToolCalls ? [] : ['tool-1']);
        await hook.unmount();
    });

    it('keeps derived arrays and item callbacks stable across fresh deps object identities', async () => {
        const members = createStableMembers();
        const hook = await renderHook(
            (deps: ItemsPipelineDeps) => useTranscriptItemsPipeline(deps),
            { initialProps: buildDeps(members) },
        );

        const first = hook.getCurrent();

        await hook.rerender(buildDeps(members));
        await hook.rerender(buildDeps(members));

        const second = hook.getCurrent();
        expect(second.decomposedItems).toBe(first.decomposedItems);
        expect(second.listData).toBe(first.listData);
        expect(second.keyExtractor).toBe(first.keyExtractor);
        expect(second.getItemType).toBe(first.getItemType);
        expect(second.resolveNearestSurvivingViewportAnchorIndex).toBe(first.resolveNearestSurvivingViewportAnchorIndex);
        expect(second.isViewportAnchorSeqLoaded).toBe(first.isViewportAnchorSeqLoaded);

        await hook.unmount();
    });
});
