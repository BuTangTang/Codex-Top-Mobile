import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as React from 'react';
import { PixelRatio } from 'react-native';
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
const pendingFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;

/** 控制 RN 帧边界：提交期间预约的下一帧不能在同一次布局提交中同步执行。 */
async function flushNativeFrame(): Promise<void> {
    await act(async () => {
        const callbacks = [...pendingFrames.values()];
        pendingFrames.clear();
        callbacks.forEach((callback) => callback(0));
    });
}

/** 旧有光标断言继续观察下一次绘制结果，而不是强制同步测量回调发布状态。 */
async function actAndFlushFrame(callback: () => void | Promise<void>): Promise<void> {
    await act(async () => { await callback(); });
    await flushNativeFrame();
}

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
        pendingFrames.clear();
        nextFrameId = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            const id = ++nextFrameId;
            pendingFrames.set(id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => { pendingFrames.delete(id); });
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

        await flushNativeFrame();
        await flushNativeFrame();
        expect(hook.getCurrent()).toEqual({ left: 150, top: 210, height: 16 });
        expect(commitCount).toBeLessThanOrEqual(3);
        expect(registrationCount).toBe(1);
    });

    /** 真实栈来自测量回调的同步状态提交；不足一个物理像素的漂移也不能反复触发布局。 */
    it('settles fractional native measurement drift fed back by React layout commits', async () => {
        let commitCount = 0;
        const inputRef = createInputRef(createMockHandle({
            measureInWindow: (callback) => callback(100, 200 + (commitCount % 2) * 0.01, 300, 100),
        }));
        const event: SelectionEvent = {
            target: 42,
            selection: {
                start: { x: 50, y: 10, position: 5 },
                end: { x: 50, y: 10, position: 5 },
            },
        };
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');
        const hook = await renderHook(() => {
            const rect = useTextInputCaretRect({ inputRef, enabled: true });
            React.useLayoutEffect(() => {
                commitCount += 1;
                capturedHandler.onSelectionChange?.(event);
            });
            return rect;
        });
        await flushNativeFrame();
        await flushNativeFrame();
        expect(hook.getCurrent()?.top).toBeCloseTo(210, 1);
        expect(commitCount).toBeLessThanOrEqual(3);
    });

    /** 大于像素阈值的真实位置变化仍发布，但一帧内的布局反馈不能形成递归提交。 */
    it('publishes changing native layout feedback across frames without a synchronous commit cascade', async () => {
        let commitCount = 0;
        const inputRef = createInputRef(createMockHandle({
            measureInWindow: (callback) => callback(100, 200 + commitCount * 20, 300, 100),
        }));
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');
        const hook = await renderHook(() => {
            const rect = useTextInputCaretRect({ inputRef, enabled: true });
            React.useLayoutEffect(() => {
                commitCount += 1;
                capturedHandler.onSelectionChange?.({ target: 42, selection: {
                    start: { x: 50, y: 10, position: 5 }, end: { x: 50, y: 10, position: 5 },
                } });
            });
            return rect;
        });
        expect(hook.getCurrent()).toBeNull();
        await flushNativeFrame();
        expect(hook.getCurrent()?.top).toBe(230);
        await flushNativeFrame();
        expect(hook.getCurrent()?.top).toBe(250);
        expect(commitCount).toBe(3);
        await hook.unmount();
        expect(pendingFrames.size).toBe(0);
    });

    /** 异步测量可能乱序返回；旧光标不能覆盖本帧较新的光标与滚动结果。 */
    it('coalesces current measurements and rejects older callbacks arriving later', async () => {
        const callbacks: Array<(x: number, y: number, width: number, height: number) => void> = [];
        const inputRef = createInputRef(createMockHandle({ measureInWindow: (callback) => { callbacks.push(callback); } }));
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');
        const hook = await renderHook(() => useTextInputCaretRect({ inputRef, enabled: true }));
        await act(async () => {
            for (const x of [10, 30]) {
                capturedHandler.onSelectionChange?.({ target: 42, selection: {
                    start: { x, y: 10, position: x }, end: { x, y: 10, position: x },
                } });
            }
            callbacks[1](100, 200, 300, 100);
            callbacks[0](100, 200, 300, 100);
        });
        await flushNativeFrame();
        expect(hook.getCurrent()).toEqual({ left: 130, top: 210, height: 16 });
    });

    /** 模糊焦点后，已跨线程排队的旧选区事件和待发布帧都应失效。 */
    it('cancels a queued frame and ignores a late selection event after disabling', async () => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');
        const hook = await renderHook(({ enabled }) => useTextInputCaretRect({ inputRef, enabled }), {
            initialProps: { enabled: true },
        });
        const oldHandler = capturedHandler.onSelectionChange!;
        const event: SelectionEvent = { target: 42, selection: {
            start: { x: 50, y: 10, position: 5 }, end: { x: 50, y: 10, position: 5 },
        } };
        await act(async () => { oldHandler(event); });
        expect(pendingFrames.size).toBe(1);
        await hook.rerender({ enabled: false });
        expect(pendingFrames.size).toBe(0);
        await act(async () => { oldHandler(event); });
        expect(pendingFrames.size).toBe(0);
        await hook.rerender({ enabled: true });
        expect(hook.getCurrent()).toBeNull();
        await actAndFlushFrame(async () => { capturedHandler.onSelectionChange?.(event); });
        expect(hook.getCurrent()).toEqual({ left: 150, top: 210, height: 16 });
    });

    /** 排队到下一帧时输入可能卸载或更换；只允许当前原生节点消费测量结果。 */
    it.each([null, 99, 42])('checks the current native target before publishing a queued rect (next target %s)', async (target) => {
        const inputRef = createInputRef();
        const { useTextInputCaretRect } = await import('../useTextInputCaretRect.native');
        const hook = await renderHook(() => useTextInputCaretRect({ inputRef, enabled: true }));
        const selection = { start: { x: 50, y: 10, position: 5 }, end: { x: 50, y: 10, position: 5 } };
        await act(async () => { capturedHandler.onSelectionChange?.({ target: 42, selection }); });
        // MultiTextInput 会随受控值更新 imperative handle；同一个原生 tag 不应被误当成新输入。
        inputRef.current = target === null ? null : createMockHandle({ getReactNodeTag: () => target });
        await flushNativeFrame();
        expect(hook.getCurrent()).toEqual(target === 42 ? { left: 150, top: 210, height: 16 } : null);
        if (target === 99) {
            await actAndFlushFrame(async () => { capturedHandler.onSelectionChange?.({ target, selection }); });
            expect(hook.getCurrent()).toEqual({ left: 150, top: 210, height: 16 });
        }
    });

    /** 相同坐标复用快照，但真实输入滚动仍必须更新光标锚点。 */
    it.each([2, 3])('retains an equal caret snapshot while still following changed input scroll at pixel ratio %s', async (pixelRatio) => {
        vi.spyOn(PixelRatio, 'get').mockReturnValue(pixelRatio);
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

        await actAndFlushFrame(/** 首次原生事件建立光标快照。 */ async () => { capturedHandler.onSelectionChange?.(event); });
        const first = hook.getCurrent();
        await actAndFlushFrame(/** 重复等值测量不得更换光标快照。 */ async () => { capturedHandler.onSelectionChange?.(event); });
        expect(hook.getCurrent()).toBe(first);
        scrollY = 0.2;
        await actAndFlushFrame(async () => { capturedHandler.onSelectionChange?.(event); });
        expect(hook.getCurrent()).toBe(first);
        // 比较上次已发布值；连续小步移动累计超过物理像素后，必须继续跟踪实际光标。
        scrollY = pixelRatio === 3 ? 0.4 : 0.6;
        await actAndFlushFrame(async () => { capturedHandler.onSelectionChange?.(event); });
        expect(hook.getCurrent()?.top).toBeCloseTo(240 - scrollY);
        scrollY = 20;
        await actAndFlushFrame(/** 滚动后沿原测量流程更新窗口坐标。 */ async () => { capturedHandler.onSelectionChange?.(event); });
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
        await actAndFlushFrame(async () => {
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

        await actAndFlushFrame(async () => {
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
        await actAndFlushFrame(async () => {
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
        await actAndFlushFrame(async () => {
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
        await actAndFlushFrame(async () => {
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
        await actAndFlushFrame(async () => {
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

        await actAndFlushFrame(async () => {
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

        await actAndFlushFrame(async () => {
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
