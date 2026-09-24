import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

import { type CodexTopPreviewPalette } from './palette';

/**
 * 把样板色板放进 Paper 主题，让输入框和按钮用同一套蓝，而不是 Paper 默认紫色。
 */
export function buildCodexTopPreviewPaperTheme(palette: CodexTopPreviewPalette): MD3Theme {
    const base = palette.scheme === 'dark' ? MD3DarkTheme : MD3LightTheme;
    return {
        ...base,
        roundness: 8,
        colors: {
            ...base.colors,
            primary: palette.brand,
            onPrimary: palette.onBrand,
            background: palette.background,
            surface: palette.surface,
            onSurface: palette.text,
            onSurfaceVariant: palette.meta,
            outline: palette.line,
        },
    };
}
