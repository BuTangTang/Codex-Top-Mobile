import * as React from 'react';
import type { View } from 'react-native';
import { describe, expect, it } from 'vitest';

import type { CaretRect } from '@/hooks/ui/textInputCaretRect';
import { resolveAgentInputCommandMenuAnchor } from '../resolveAgentInputCommandMenuAnchor';

describe('resolveAgentInputCommandMenuAnchor (D34/D42)', () => {
    it('returns a rect-mode anchor when caret rect is available (D42: no pre-offset)', () => {
        const caretRect: CaretRect = { left: 100, top: 200, height: 18 };
        const fallbackRef = React.createRef<View>();

        const anchor = resolveAgentInputCommandMenuAnchor(caretRect, fallbackRef);

        expect(anchor).toEqual({
            kind: 'rect',
            rect: { left: 100, top: 200, height: 18 },
            coordinateSpace: 'window',
        });
    });

    it('falls back to a view-mode anchor when caret rect is null (D34 runtime guard)', () => {
        const fallbackRef = React.createRef<View>();

        const anchor = resolveAgentInputCommandMenuAnchor(null, fallbackRef);

        expect(anchor).toEqual({ kind: 'view', ref: fallbackRef });
    });

    it('does not pre-offset the rect top by caret height (D42)', () => {
        // The Popover applies placement + gap; the host must pass the raw caret rect.
        const caretRect: CaretRect = { left: 50, top: 300, height: 22 };
        const fallbackRef = React.createRef<View>();

        const anchor = resolveAgentInputCommandMenuAnchor(caretRect, fallbackRef);

        if (anchor.kind !== 'rect') {
            throw new Error('expected rect anchor');
        }
        expect(anchor.rect.top).toBe(300);
        expect(anchor.rect.height).toBe(22);
    });

    it('omits width from the rect (caret has no measurable width)', () => {
        const caretRect: CaretRect = { left: 10, top: 20, height: 16 };
        const fallbackRef = React.createRef<View>();

        const anchor = resolveAgentInputCommandMenuAnchor(caretRect, fallbackRef);

        if (anchor.kind !== 'rect') {
            throw new Error('expected rect anchor');
        }
        expect((anchor.rect as { width?: number }).width).toBeUndefined();
    });
});
