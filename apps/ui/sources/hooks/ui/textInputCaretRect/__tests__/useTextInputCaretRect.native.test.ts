import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as React from 'react';
import { act } from 'react-test-renderer';
import { renderHook, standardCleanup } from '@/dev/testkit';

import type { TextInputCaretRectHandle } from '../useTextInputCaretRect.types';

type SelectionEvent = {
    target: number;
    selection: {
        start: { x: number; y: number; position: number };
        end: { x: number; y: number; position: number };
    };
};

type HandlerMap = {
    onSelectionChange?: (e: SelectionEvent) => void;
};

/**
 * We capture the handler map that the hook registers with useFocusedInputHandler
 * so we can simulate selection events in tests.
 */
let capturedHandler: HandlerMap = {};
let registrationCount = 0;

vi.mock('react-native-keyboard-controller', () => ({
    /** 按真实库的 layout effect 与依赖注册事件，避免测试把每次渲染误当重新订阅。 */
    useFocusedInputHandler: vi.fn((handlers: HandlerMap, dependencies?: React.DependencyList) => {
        React.useLayoutEffect(/** 保存本次实际注册的原生边界回调，并在清理时释放。 */ () => {
            registrationCount += 1;
            capturedHandler = handlers;
            return /** 模拟真实订阅销毁，后续用例不能继续持有旧注册。 */ () => { capturedHandler = {}; };
        }, dependencies);
    }),
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    KeyboardProvider: ({ children }: { children: unknown }) => children,
    useKeyboardState: () => ({ height: 0, isVisible: false, progress: 0 }),
}));

function createMockHandle(overrides?: Partial<TextInputCaretRectHandle>): TextInputCaretRectHandle {
    return {
        measureInWindow: overrides?.measureInWindow ?? vi.fn((cb) => cb(100, 200, 300, 100)),
        getReactNodeTag: overrides?.getReactNodeTag ?? (() => 42),
        getInputElement: overrides?.getInputElement ?? (() => null),
        getScrollOffset: overrides?.getScrollOffset ?? (() => ({ x: 0, y: 0 })),
    };
}

function createInputRef(handle: TextInputCaretRectHandle | null = createMockHandle()) {
    return { current: handle };
}

describe('useTextInputCaretRect (native)', () => {
    beforeEach(/** 每例释放旧树及原生订阅记录，保证注册次数只属于当前测试。 */ () => {
        standardCleanup();
        capturedHandler = {};
        registrationCount = 0;
    });

    /** 原生布局反馈重复报告相同光标时必须收敛，不能因测量结果对象变化持续提交。 */
    it('settles repeated native selection measurements fed back after layout commits', async () => {
        const inputRef = createInputRef();
        const event: SelectionEvent = {
            target: 42,
            selection: {
                start: { x: 50, y: 10, position: 5 },
                end: { x: 50, y: 10, position: 5 },
            },
        };
        let commitCount = 0;
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');
        const hook = await renderHook(/** 模拟原生绘制后的重复测量反馈，不替换被测 hook。 */ () => {
            const rect = useTextInputCaretRect({ inputRef, enabled: true });
            React.useLayoutEffect(/** 每次提交回放同一个已测得的光标，暴露状态反馈环。 */ () => {
                commitCount += 1;
                capturedHandler.onSelectionChange?.(event);
            });
            return rect;
        });

        expect(hook.getCurrent()).toEqual({ left: 150, top: 210, height: 16 });
        expect(commitCount).toBeLessThanOrEqual(3);
        expect(registrationCount).toBe(1);
    });

    /** 相同坐标复用快照，但真实输入滚动仍必须更新光标锚点。 */
    it('retains an equal caret snapshot while still following changed input scroll', async () => {
        let scrollY = 0;
        const inputRef = createInputRef(createMockHandle({
            /** 每次测量读取当前滚动，不能仅按重复 selection 丢弃后续事件。 */
            getScrollOffset: () => ({ x: 0, y: scrollY }),
        }));
        const event: SelectionEvent = {
            target: 42,
            selection: {
                start: { x: 50, y: 40, position: 5 },
                end: { x: 50, y: 40, position: 5 },
            },
        };
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');
        const hook = await renderHook(/** 挂载真实测量 hook，事件仅由原生边界替身提供。 */ () =>
            useTextInputCaretRect({ inputRef, enabled: true }),
        );

        await act(/** 首次原生事件建立光标快照。 */ async () => { capturedHandler.onSelectionChange?.(event); });
        const first = hook.getCurrent();
        await act(/** 重复等值测量不得更换光标快照。 */ async () => { capturedHandler.onSelectionChange?.(event); });
        expect(hook.getCurrent()).toBe(first);
        scrollY = 20;
        await act(/** 滚动后沿原测量流程更新窗口坐标。 */ async () => { capturedHandler.onSelectionChange?.(event); });
        expect(hook.getCurrent()).toEqual({ left: 150, top: 220, height: 16 });
        expect(hook.getCurrent()).not.toBe(first);
        expect(registrationCount).toBe(1);
    });

    it('returns null before any selection event', async () => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        const hook = await renderHook(() =>
            useTextInputCaretRect({ inputRef, enabled: true }),
        );

        expect(hook.getCurrent()).toBeNull();
    });

    it('returns a CaretRect after a selection event fires', async () => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        const hook = await renderHook(() =>
            useTextInputCaretRect({ inputRef, enabled: true }),
        );

        // Simulate a selection event from keyboard-controller (wrapped in act for state update)
        await act(async () => {
            capturedHandler.onSelectionChange?.({
                target: 42,
                selection: {
                    start: { x: 50, y: 10, position: 5 },
                    end: { x: 50, y: 10, position: 5 },
                },
            });
        });

        expect(hook.getCurrent()).toEqual({
            left: 150,
            top: 210,
            height: 16,
        });
    });

    it('subtracts the input\'s scroll offset so the rect tracks the VISIBLE caret', async () => {
        // The native caret payload is content-relative. Once the composer clamps at
        // max height and scrolls, an uncompensated rect sits too far down by exactly
        // the scroll amount, which is what dropped the autocomplete menu onto the
        // line holding the trigger character.
        const inputRef = createInputRef(createMockHandle({
            getScrollOffset: () => ({ x: 0, y: 240 }),
        }));
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        const hook = await renderHook(() =>
            useTextInputCaretRect({ inputRef, enabled: true }),
        );

        await act(async () => {
            capturedHandler.onSelectionChange?.({
                target: 42,
                selection: {
                    start: { x: 50, y: 300, position: 5 },
                    end: { x: 50, y: 322, position: 5 },
                },
            });
        });

        expect(hook.getCurrent()).toEqual({
            left: 150,
            top: 260,
            height: 22,
        });
    });

    it('filters events from different inputs (D37: multi-input filter)', async () => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        const hook = await renderHook(() =>
            useTextInputCaretRect({ inputRef, enabled: true }),
        );

        // Event from a different input (target 999, our tag is 42)
        await act(async () => {
            capturedHandler.onSelectionChange?.({
                target: 999,
                selection: {
                    start: { x: 50, y: 10, position: 5 },
                    end: { x: 50, y: 10, position: 5 },
                },
            });
        });

        expect(hook.getCurrent()).toBeNull();
    });

    it('returns null when enabled is false', async () => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        const hook = await renderHook(() =>
            useTextInputCaretRect({ inputRef, enabled: false }),
        );

        expect(hook.getCurrent()).toBeNull();
    });

    it('registers empty handler map when disabled (D38)', async () => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        await renderHook(() =>
            useTextInputCaretRect({ inputRef, enabled: false }),
        );

        // When disabled, handler map should be empty (no onSelectionChange)
        expect(capturedHandler.onSelectionChange).toBeUndefined();
    });

    it('registers onSelectionChange when enabled', async () => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        await renderHook(() =>
            useTextInputCaretRect({ inputRef, enabled: true }),
        );

        expect(capturedHandler.onSelectionChange).toBeDefined();
    });

    it('clears rect when enabled transitions from true to false', async () => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        const hook = await renderHook(
            (props: { enabled: boolean }) =>
                useTextInputCaretRect({ inputRef, enabled: props.enabled }),
            { initialProps: { enabled: true } },
        );

        // Fire a selection event while enabled
        await act(async () => {
            capturedHandler.onSelectionChange?.({
                target: 42,
                selection: {
                    start: { x: 50, y: 10, position: 5 },
                    end: { x: 50, y: 10, position: 5 },
                },
            });
        });

        expect(hook.getCurrent()).not.toBeNull();

        // Disable
        await hook.rerender({ enabled: false });

        expect(hook.getCurrent()).toBeNull();
    });

    it('does not update state from stale measureInWindow callback after disable', async () => {
        let pendingCallback: ((x: number, y: number, w: number, h: number) => void) | null = null;
        const mockHandle = createMockHandle({
            measureInWindow: vi.fn((cb) => {
                // Store the callback instead of calling it immediately
                pendingCallback = cb;
            }),
        });
        const inputRef = createInputRef(mockHandle);
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        const hook = await renderHook(
            (props: { enabled: boolean }) =>
                useTextInputCaretRect({ inputRef, enabled: props.enabled }),
            { initialProps: { enabled: true } },
        );

        // Fire event (callback is now pending, not yet executed)
        await act(async () => {
            capturedHandler.onSelectionChange?.({
                target: 42,
                selection: {
                    start: { x: 50, y: 10, position: 5 },
                    end: { x: 50, y: 10, position: 5 },
                },
            });
        });

        // Disable before the callback fires (bumps generation)
        await hook.rerender({ enabled: false });

        // Now execute the stale callback
        await act(async () => {
            pendingCallback?.(100, 200, 300, 100);
        });

        // Should still be null (stale callback was ignored)
        expect(hook.getCurrent()).toBeNull();
    });

    it('ignores event when handle ref is null', async () => {
        const inputRef = createInputRef(null);
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        const hook = await renderHook(() =>
            useTextInputCaretRect({ inputRef, enabled: true }),
        );

        await act(async () => {
            capturedHandler.onSelectionChange?.({
                target: 42,
                selection: {
                    start: { x: 50, y: 10, position: 5 },
                    end: { x: 50, y: 10, position: 5 },
                },
            });
        });

        expect(hook.getCurrent()).toBeNull();
    });

    it('ignores event when getReactNodeTag returns null', async () => {
        const mockHandle = createMockHandle({
            getReactNodeTag: () => null,
        });
        const inputRef = createInputRef(mockHandle);
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        const hook = await renderHook(() =>
            useTextInputCaretRect({ inputRef, enabled: true }),
        );

        await act(async () => {
            capturedHandler.onSelectionChange?.({
                target: 42,
                selection: {
                    start: { x: 50, y: 10, position: 5 },
                    end: { x: 50, y: 10, position: 5 },
                },
            });
        });

        expect(hook.getCurrent()).toBeNull();
    });

    it('defaults enabled to true when not provided', async () => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');

        await renderHook(() =>
            useTextInputCaretRect({ inputRef }),
        );

        // Should have registered an onSelectionChange handler
        expect(capturedHandler.onSelectionChange).toBeDefined();
    });
});
