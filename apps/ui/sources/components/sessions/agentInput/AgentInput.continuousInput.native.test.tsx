import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import type { ComposerSuggestionKindId } from '@/components/autocomplete/composerSuggestionGrammar';
import { installAgentInputCommonModuleMocks } from './agentInputTestHelpers';

const nativeState = vi.hoisted(() => ({
    selectionHandler: null as null | ((event: {
        target: number;
        selection: { start: { x: number; y: number }; end: { x: number; y: number } };
    }) => void),
}));

installAgentInputCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeNativeMock({ platformOS: 'android' }, {
            TextInput: 'TextInput',
            findNodeHandle: () => 7,
            useWindowDimensions: () => ({ width: 393, height: 852, scale: 2.75, fontScale: 1 }),
        });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        const scope = { serverId: 'synthetic-server', accountId: 'synthetic-account' };
        return createStorageModuleStub({
            useSettings: () => settingsDefaults,
            useSetting: (key: keyof typeof settingsDefaults) => settingsDefaults[key],
            useActiveServerAccountScope: () => scope,
        });
    },
});

vi.mock('@react-navigation/native', () => ({
    useIsFocused: () => true,
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        materializeExistingSessionDraft: vi.fn(async () => undefined),
        fetchUserMessageHistoryPage: vi.fn(async () => ({ status: 'loaded', rows: [], hasMore: false, nextBeforeSeq: null })),
    },
}));

vi.mock('react-native-keyboard-controller', async (importOriginal) => ({
    ...await importOriginal<object>(),
    useFocusedInputHandler: (handler: { onSelectionChange?: typeof nativeState.selectionHandler }, dependencies?: React.DependencyList) => {
        React.useLayoutEffect(() => {
            nativeState.selectionHandler = handler.onSelectionChange ?? null;
            return () => { nativeState.selectionHandler = null; };
        }, dependencies);
    },
}));

/** 只读取真实输入最终交给 RN 的样式，不复制 AgentInput 的行高计算。 */
function flattenStyle(style: unknown): Record<string, number> {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
    return style && typeof style === 'object' ? style as Record<string, number> : {};
}

describe('AgentInput continuous native typing', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    beforeEach(() => {
        frames.clear();
        nextFrame = 0;
        nativeState.selectionHandler = null;
        // Node 没有 RN 帧调度；保留异步帧边界，不能同步调用回调掩盖布局递归。
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        });
        vi.stubGlobal('cancelAnimationFrame', (frame: number) => { frames.delete(frame); });
    });
    it.each([
        ['the reported long spaced draft', `UI123_keyboard_test${'long_text_with_spaces '.repeat(45)}`, ['slashCommand', 'file']],
        ['six explicit lines', 'line one\nline two\nline three\nline four\nline five\nline six', ['slashCommand', 'file']],
        ['ordinary desktop chat without autocomplete', `UI123_keyboard_test${'long_text_with_spaces '.repeat(45)}`, []],
    ] as const)('keeps text, selection and scroll stable while typing and deleting %s', async (label, draft, autocompleteKinds) => {
        const { AgentInput } = await import('./AgentInput');
        const { useSessionAgentInputComposerPersistence } = await import('@/hooks/session/useSessionAgentInputComposerPersistence');
        const { useDraft } = await import('@/hooks/session/useDraft');
        const onSend = vi.fn();
        const measureInWindow = vi.fn((callback: (x: number, y: number, width: number, height: number) => void) => callback(70, 460, 240, 126));
        const sessionId = `synthetic-continuous-input-${label}`;
        let persistedInput: ReturnType<typeof useSessionAgentInputComposerPersistence>['inputPersistence'];
        // 使用真实 AgentInput 和 MultiTextInput；仅 RN TextInput 是 Node 中的系统边界。
        function ControlledComposer() {
            const [value, setValue] = React.useState('');
            const { setDraftValue } = useDraft(sessionId, value, setValue);
            const persistence = useSessionAgentInputComposerPersistence({
                sessionId, text: value, textLength: value.length, fontScale: 1,
            });
            persistedInput = persistence.inputPersistence;
            return <AgentInput
                sessionId={sessionId}
                value={value}
                onChangeText={setDraftValue}
                placeholder="Message"
                onSend={onSend}
                autocompleteKinds={autocompleteKinds}
                autocompleteSuggestions={async () => []}
                inputPersistence={persistence.inputPersistence}
                structuredInputMentions={persistence.structuredInputPersistence.mentions}
                onStructuredInputMentionsChange={persistence.structuredInputPersistence.onMentionsChange}
            />;
        }

        const screen = await renderScreen(<ControlledComposer />, {
            createNodeMock: (element) => element.type === 'TextInput' ? {
                measureInWindow,
                setNativeProps: vi.fn(), focus: vi.fn(), blur: vi.fn(),
            } : null,
        });
        const input = () => screen.tree.findByType('TextInput');
        const originalInput = input();
        await act(async () => { input().props.onFocus(); });
        if (autocompleteKinds.length > 0) expect(nativeState.selectionHandler).toBeTypeOf('function');

        /** 每次输入经过真实受控草稿后，再传入 RN 的测量/滚动/光标事件；重复事件也保留。 */
        async function changeDraft(next: string) {
            await act(async () => {
                input().props.onChangeText(next);
            });
            const style = flattenStyle(input().props.style);
            // 显式换行无需推测字体宽度；连续空格用已声明的原生换行边界样例覆盖。
            const lines = next.includes('\n') ? next.split('\n').length : Math.max(1, Math.ceil(next.length / 24));
            // RN 按字体自然测量行高，组件未显式设置 lineHeight；这里明确使用系统事件样例。
            // 本测试验证回传链路，不把 Node 中的 22 px 样例当成实机字体/换行验收。
            const measuredLineHeight = 22;
            const contentHeight = lines * measuredLineHeight + style.paddingTop + style.paddingBottom;
            const scrollY = Math.max(0, contentHeight - style.maxHeight);
            expect(Number.isFinite(scrollY)).toBe(true);
            await act(async () => {
                for (let repeat = 0; repeat < 2; repeat += 1) {
                    input().props.onSelectionChange({ nativeEvent: { selection: { start: next.length, end: next.length } } });
                    input().props.onContentSizeChange({ nativeEvent: { contentSize: { height: contentHeight } } });
                    input().props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: scrollY } } });
                    nativeState.selectionHandler?.({ target: 7, selection: {
                        start: { x: 0, y: (lines - 1) * measuredLineHeight },
                        end: { x: 0, y: lines * measuredLineHeight },
                    } });
                }
            });
            await act(async () => {
                const pending = [...frames.values()];
                frames.clear();
                pending.forEach((callback) => callback(0));
            });
            expect(input()).toBe(originalInput);
            expect(input().props.value).toBe(next);
        }
        for (let length = 1; length <= draft.length; length += 1) {
            await changeDraft(draft.slice(0, length));
        }
        expect(input().props.value).toBe(draft);
        expect(persistedInput!.initialSelection).toEqual({ start: draft.length, end: draft.length });
        expect(persistedInput!.initialScrollY).toBeGreaterThan(0);
        expect(flattenStyle(input().props.style).maxHeight).toBe(126);
        expect(flattenStyle(input().props.style).height).toBeUndefined();
        for (let length = draft.length - 1; length >= 1; length -= 1) {
            await changeDraft(draft.slice(0, length));
        }
        expect(input().props.value).toBe(draft[0]);
        expect(persistedInput!.initialSelection).toEqual({ start: 1, end: 1 });
        expect(persistedInput!.initialScrollY).toBe(0);
        expect(input().props.scrollEnabled).toBe(true);
        expect(onSend).not.toHaveBeenCalled();
        if (autocompleteKinds.length === 0) {
            // 第一份长草稿清空后，下一份草稿仍经过同一真实输入/持久化 owner。
            await changeDraft('');
            const nextDraft = 'next_draft '.repeat(8);
            for (let length = 1; length <= nextDraft.length; length += 1) {
                await changeDraft(nextDraft.slice(0, length));
            }
            expect(input().props.value).toBe(nextDraft);
            expect(persistedInput!.initialSelection).toEqual({ start: nextDraft.length, end: nextDraft.length });
            const { AgentInputCommandMenu } = await import('./commandMenu/AgentInputCommandMenu');
            expect.soft(nativeState.selectionHandler).toBeNull();
            expect.soft(measureInWindow.mock.calls.length).toBe(0);
            expect.soft(screen.tree.findByType(AgentInputCommandMenu).props.anchor.kind).toBe('view');
        } else {
            expect(measureInWindow).toHaveBeenCalled();
        }
    });

    it('anchors the first command character while focused and releases caret work when autocomplete is removed', async () => {
        const { AgentInput } = await import('./AgentInput');
        const { AgentInputCommandMenu } = await import('./commandMenu/AgentInputCommandMenu');
        const measureInWindow = vi.fn((callback: (x: number, y: number, width: number, height: number) => void) => callback(70, 460, 240, 126));
        const suggestions = async () => [{ kind: 'slashCommand' as const, key: 'synthetic-command', text: '/synthetic' }];
        let setKinds!: React.Dispatch<React.SetStateAction<readonly ComposerSuggestionKindId[]>>;
        function ControlledComposer() {
            const [value, setValue] = React.useState('');
            const [kinds, updateKinds] = React.useState<readonly ComposerSuggestionKindId[]>(['slashCommand']);
            setKinds = updateKinds;
            return <AgentInput sessionId="synthetic-first-command" value={value} onChangeText={setValue} placeholder="Message" onSend={() => {}}
                autocompleteKinds={kinds} autocompleteSuggestions={suggestions} />;
        }
        const screen = await renderScreen(<ControlledComposer />, {
            createNodeMock: (element) => element.type === 'TextInput' ? {
                measureInWindow, setNativeProps: vi.fn(), focus: vi.fn(), blur: vi.fn(),
            } : null,
        });
        const input = () => screen.tree.findByType('TextInput');
        const menu = () => screen.tree.findByType(AgentInputCommandMenu);
        await act(async () => { input().props.onFocus(); });
        // 尚未输入触发字符，真实 hook 已订阅，不能改成 menu-open/activeWord 后才开启。
        expect(input().props.value).toBe('');
        expect(menu().props.open).toBe(false);
        expect(nativeState.selectionHandler).toBeTypeOf('function');
        const focusedHandler = nativeState.selectionHandler!;
        await act(async () => {
            input().props.onChangeText('/');
            input().props.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 1 } } });
            focusedHandler({ target: 7, selection: { start: { x: 8, y: 0 }, end: { x: 8, y: 22 } } });
        });
        await act(async () => {
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach((callback) => callback(0));
        });
        expect(menu().props.open).toBe(true);
        expect(menu().props.anchor).toEqual({ kind: 'rect', rect: { left: 78, top: 460, height: 22 }, coordinateSpace: 'window' });
        // 第二个原生测量已排帧但未发布，此时能力消失；旧事件/旧帧均不能再推进光标状态。
        await act(async () => {
            focusedHandler({ target: 7, selection: { start: { x: 16, y: 0 }, end: { x: 16, y: 22 } } });
        });
        const measuredBeforeDisable = measureInWindow.mock.calls.length;
        expect(frames.size).toBeGreaterThan(0);
        await act(async () => { setKinds([]); });
        await act(async () => {
            focusedHandler({ target: 7, selection: { start: { x: 24, y: 0 }, end: { x: 24, y: 22 } } });
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach((callback) => callback(0));
        });
        expect.soft(nativeState.selectionHandler).toBeNull();
        expect.soft(measureInWindow).toHaveBeenCalledTimes(measuredBeforeDisable);
        expect.soft(menu().props.anchor.kind).toBe('view');
        expect(input().props.value).toBe('/');
    });
});
