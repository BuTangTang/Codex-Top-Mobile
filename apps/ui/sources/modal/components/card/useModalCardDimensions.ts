import * as React from 'react';
import { useWindowDimensions } from 'react-native';

export type ModalCardSizePreset = 'dialog' | 'md' | 'lg';

export type ModalCardDimensions = Readonly<{
    width: number;
    maxHeight: number;
}>;

export type ModalCardViewportMargin = number | Readonly<{
    horizontal?: number;
    vertical?: number;
}>;

export type ModalCardDimensionOptions = Readonly<{
    size?: ModalCardSizePreset;
    width?: number;
    maxHeightRatio?: number;
    viewportMargin?: ModalCardViewportMargin;
}>;

type ModalCardDimensionPreset = Readonly<{
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight?: number;
    heightRatio: number;
}>;

const DEFAULT_MODAL_CARD_VIEWPORT_MARGIN = {
    horizontal: 40,
    vertical: 48,
} as const;

const MODAL_CARD_MIN_VERTICAL_VIEWPORT_MARGIN = DEFAULT_MODAL_CARD_VIEWPORT_MARGIN.vertical;

const MODAL_CARD_PRESETS: Record<ModalCardSizePreset, ModalCardDimensionPreset> = {
    dialog: {
        minWidth: 280,
        maxWidth: 360,
        minHeight: 180,
        heightRatio: 0.48,
    },
    md: {
        minWidth: 320,
        maxWidth: 560,
        minHeight: 280,
        maxHeight: 760,
        heightRatio: 0.85,
    },
    lg: {
        minWidth: 320,
        maxWidth: 840,
        minHeight: 320,
        maxHeight: 860,
        heightRatio: 0.85,
    },
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function resolveViewportMargin(option: ModalCardViewportMargin | undefined): Readonly<{
    horizontal: number;
    vertical: number;
}> {
    if (typeof option === 'number') {
        return {
            horizontal: option,
            vertical: Math.max(option, MODAL_CARD_MIN_VERTICAL_VIEWPORT_MARGIN),
        };
    }

    return {
        horizontal: option?.horizontal ?? DEFAULT_MODAL_CARD_VIEWPORT_MARGIN.horizontal,
        vertical: Math.max(
            option?.vertical ?? DEFAULT_MODAL_CARD_VIEWPORT_MARGIN.vertical,
            MODAL_CARD_MIN_VERTICAL_VIEWPORT_MARGIN,
        ),
    };
}

export function resolveModalCardDimensions(
    windowDimensions: Readonly<{ width: number; height: number }>,
    options: ModalCardDimensionOptions = {},
): ModalCardDimensions {
    const preset = MODAL_CARD_PRESETS[options.size ?? 'md'];
    const viewportMargin = resolveViewportMargin(options.viewportMargin);
    const availableWidth = Math.max(0, Math.floor(windowDimensions.width - viewportMargin.horizontal * 2));
    const width = options.width != null
        ? Math.min(availableWidth, options.width)
        : clamp(availableWidth, preset.minWidth, preset.maxWidth);
    const ratioHeight = Math.floor(windowDimensions.height * (options.maxHeightRatio ?? preset.heightRatio));
    const viewportHeight = Math.max(0, Math.floor(windowDimensions.height - viewportMargin.vertical * 2));
    const availableHeight = Math.min(viewportHeight, ratioHeight);
    const maxHeight = clamp(
        availableHeight,
        preset.minHeight,
        preset.maxHeight ?? availableHeight,
    );

    return {
        width,
        maxHeight,
    };
}

export function useModalCardDimensions(options: ModalCardDimensionOptions = {}): ModalCardDimensions {
    const windowDimensions = useWindowDimensions();
    return React.useMemo(
        () => resolveModalCardDimensions(windowDimensions, options),
        [options, windowDimensions.height, windowDimensions.width],
    );
}
