import type * as React from 'react';
import type { View } from 'react-native';

import type { CommandMenuAnchor } from '@/components/ui/commandMenu';
import type { CaretRect } from '@/hooks/ui/textInputCaretRect';

/**
 * Resolves the `<CommandMenu>` anchor for AgentInput from the current caret
 * rect and the composer's fallback view ref.
 *
 * Per the plan:
 * - D34 (no feature flag): the only rollback mechanism is the runtime guard
 *   `caretRect ? rect : view`. If `useTextInputCaretRect` returns `null`
 *   (no focused input, no event yet, platform unsupported), this falls back
 *   to the composer view anchor — identical to the pre-Lane-E behavior.
 * - D42 (no pre-offset): the rect is passed raw (`{ left, top, height }`);
 *   `Popover` placement + `gap` position the popup relative to the caret.
 *   Do NOT add caret height + gap to `top`.
 *
 * The width is intentionally omitted: a caret has no measurable width,
 * and `PopoverAnchor.rect.width` is optional.
 */
export function resolveAgentInputCommandMenuAnchor(
    caretRect: CaretRect | null,
    composerAnchorRef: React.RefObject<View | null>,
): CommandMenuAnchor {
    if (caretRect !== null) {
        return {
            kind: 'rect',
            rect: {
                left: caretRect.left,
                top: caretRect.top,
                height: caretRect.height,
            },
            coordinateSpace: 'window',
        };
    }
    return { kind: 'view', ref: composerAnchorRef };
}
