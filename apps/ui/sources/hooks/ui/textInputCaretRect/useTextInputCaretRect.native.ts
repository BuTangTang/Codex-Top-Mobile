import * as React from 'react';
import { PixelRatio } from 'react-native';
import { useFocusedInputHandler } from 'react-native-keyboard-controller';
import { runOnJS } from 'react-native-reanimated';

import type {
    CaretRect,
    UseTextInputCaretRectInput,
} from './useTextInputCaretRect.types';

export type { CaretRect, TextInputCaretRectHandle, UseTextInputCaretRectInput } from './useTextInputCaretRect.types';

/** Minimum caret height fallback (single cursor with no measurable span). */
const MIN_CARET_HEIGHT = 16;

/** 小于一个物理像素的测量漂移没有新的可见锚点，比较上次发布值以保留累积移动。 */
function areNativeCaretRectsVisuallyEqual(current: CaretRect | null, next: CaretRect): boolean {
    const pixelSize = 1 / PixelRatio.get();
    return current !== null
        && Math.abs(current.left - next.left) < pixelSize
        && Math.abs(current.top - next.top) < pixelSize
        && Math.abs(current.height - next.height) < pixelSize;
}

/**
 * Pure, unit-testable math: transforms input-local selection coordinates
 * into a window-relative CaretRect using the input's window offset.
 *
 * `inputScroll` is required, not defaulted: iOS reports the caret through
 * `UITextView.caretRect(for:)`, which is CONTENT-relative, so the input's own
 * scroll offset must come back out. Omitting it left the caret anchor too far
 * down by exactly the scroll amount once the composer clamped at max height —
 * the autocomplete menu then covered the line holding the trigger character.
 * The web sibling subtracts `scrollLeft`/`scrollTop` for the same reason.
 */
export function computeNativeCaretRect(
    inputOffset: Readonly<{ x: number; y: number }>,
    selection: Readonly<{
        start: Readonly<{ x: number; y: number }>;
        end: Readonly<{ x: number; y: number }>;
    }>,
    inputScroll: Readonly<{ x: number; y: number }>,
): CaretRect {
    const rawHeight = selection.end.y - selection.start.y;
    return {
        left: inputOffset.x + selection.start.x - inputScroll.x,
        top: inputOffset.y + selection.start.y - inputScroll.y,
        height: Math.max(MIN_CARET_HEIGHT, rawHeight),
    };
}

/**
 * 跟踪当前原生输入的选区，将输入内坐标转换为窗口光标位置供菜单定位。
 * 测量按帧合并后发布，避免原生布局反馈同步递归提交；停用或首个事件前返回空。
 */
export function useTextInputCaretRect(input: UseTextInputCaretRectInput): CaretRect | null {
    const { inputRef, enabled = true } = input;

    const [rect, setRect] = React.useState<CaretRect | null>(null);
    const publishedRectRef = React.useRef<CaretRect | null>(null);
    const pendingRectRef = React.useRef<Readonly<{ target: number; rect: CaretRect }> | null>(null);
    const publishFrameRef = React.useRef<number | null>(null);
    const measurementSequenceRef = React.useRef(0);
    const trackingEnabledRef = React.useRef(enabled);

    // Generation counter to guard against stale async measureInWindow callbacks.
    const generationRef = React.useRef(0);

    /** 在 JS 线程处理原生选区事件，只测量属于当前输入的光标。 */
    const forwardEvent = React.useCallback(
        (
            target: number,
            selection: Readonly<{
                start: Readonly<{ x: number; y: number }>;
                end: Readonly<{ x: number; y: number }>;
            }>,
        ) => {
            if (!trackingEnabledRef.current) return;
            const handle = inputRef.current;
            if (handle == null) return;

            // Multi-input filter (D37): only respond to events from our input.
            const nodeTag = handle.getReactNodeTag();
            if (nodeTag == null || target !== nodeTag) return;

            // Capture the current generation before the async call.
            const gen = generationRef.current;
            const sequence = ++measurementSequenceRef.current;

            handle.measureInWindow(/** 合并当前输入的窗口位置和滚动，拒绝已失效的异步测量。 */ (ax, ay, _w, _h) => {
                // Stale callback guard: if generation has changed, discard.
                if (gen !== generationRef.current || sequence !== measurementSequenceRef.current) return;
                if (inputRef.current?.getReactNodeTag() !== target) return;

                const nextRect = computeNativeCaretRect(
                    { x: ax, y: ay },
                    selection,
                    handle.getScrollOffset(),
                );
                if (![nextRect.left, nextRect.top, nextRect.height].every(Number.isFinite)) return;
                // 原生测量可能位于 React 布局提交中；此处只保留最新结果，不同步触发另一轮提交。
                pendingRectRef.current = { target, rect: nextRect };
                if (publishFrameRef.current !== null) return;
                if (areNativeCaretRectsVisuallyEqual(publishedRectRef.current, nextRect)) {
                    pendingRectRef.current = null;
                    return;
                }
                publishFrameRef.current = requestAnimationFrame(/** 每帧最多发布一次有效光标位置。 */ () => {
                    publishFrameRef.current = null;
                    const pending = pendingRectRef.current;
                    pendingRectRef.current = null;
                    // 测量到发布之间可能卸载或切换输入；wrapper handle 会刷新，原生 tag 才是身份。
                    if (!pending || inputRef.current?.getReactNodeTag() !== pending.target) return;
                    if (areNativeCaretRectsVisuallyEqual(publishedRectRef.current, pending.rect)) return;
                    // 在 dispatch 前去重；不能依赖 setState updater 返回旧对象来打断布局反馈环。
                    publishedRectRef.current = pending.rect;
                    setRect(pending.rect);
                });
            });
        },
        [inputRef],
    );

    // Register or deregister the selection handler based on enabled state (D38).
    // When disabled, pass an empty handler map so the hook releases its subscription.
    useFocusedInputHandler(
        enabled
            ? {
                onSelectionChange: (e) => {
                    'worklet';
                    runOnJS(forwardEvent)(e.target, e.selection);
                },
            }
            : {},
        [enabled, forwardEvent],
    );

    // When disabled or unmounted, clear cached rect and bump generation.
    React.useLayoutEffect(() => {
        trackingEnabledRef.current = enabled;
        if (!enabled) {
            generationRef.current += 1;
            publishedRectRef.current = null;
            setRect(null);
        }

        return () => {
            trackingEnabledRef.current = false;
            generationRef.current += 1;
            pendingRectRef.current = null;
            if (publishFrameRef.current !== null) {
                cancelAnimationFrame(publishFrameRef.current);
                publishFrameRef.current = null;
            }
        };
    }, [enabled]);

    // Return null while disabled or before first event (D17).
    if (!enabled) return null;

    return rect;
}
