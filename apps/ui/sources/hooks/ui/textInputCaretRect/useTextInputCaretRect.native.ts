import * as React from 'react';
import { useFocusedInputHandler } from 'react-native-keyboard-controller';
import { runOnJS } from 'react-native-reanimated';

import type {
    CaretRect,
    UseTextInputCaretRectInput,
} from './useTextInputCaretRect.types';

export type { CaretRect, TextInputCaretRectHandle, UseTextInputCaretRectInput } from './useTextInputCaretRect.types';

/** Minimum caret height fallback (single cursor with no measurable span). */
const MIN_CARET_HEIGHT = 16;

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
 * 等值测量保留原快照，避免布局反馈反复更新输入树；停用或首个事件前返回空。
 */
export function useTextInputCaretRect(input: UseTextInputCaretRectInput): CaretRect | null {
    const { inputRef, enabled = true } = input;

    const [rect, setRect] = React.useState<CaretRect | null>(null);

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
            const handle = inputRef.current;
            if (handle == null) return;

            // Multi-input filter (D37): only respond to events from our input.
            const nodeTag = handle.getReactNodeTag();
            if (nodeTag == null || target !== nodeTag) return;

            // Capture the current generation before the async call.
            const gen = generationRef.current;

            handle.measureInWindow(/** 合并当前输入的窗口位置和滚动，拒绝已失效的异步测量。 */ (ax, ay, _w, _h) => {
                // Stale callback guard: if generation has changed, discard.
                if (gen !== generationRef.current) return;

                const nextRect = computeNativeCaretRect(
                    { x: ax, y: ay },
                    selection,
                    handle.getScrollOffset(),
                );
                // 原生布局可能重复报告同一光标，等值时不发布新对象或触发另一轮布局。
                setRect(/** 只发布位置或高度确实变化的快照，同时保留真实滚动更新。 */ (currentRect) => (
                    currentRect?.left === nextRect.left
                    && currentRect.top === nextRect.top
                    && currentRect.height === nextRect.height
                        ? currentRect
                        : nextRect
                ));
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
    React.useEffect(() => {
        if (!enabled) {
            generationRef.current += 1;
            setRect(null);
        }

        return () => {
            generationRef.current += 1;
        };
    }, [enabled]);

    // Return null while disabled or before first event (D17).
    if (!enabled) return null;

    return rect;
}
