import * as React from 'react';
import { Appearance } from 'react-native';

import { codexTopPreviewPalettes, type CodexTopPreviewPalette, type CodexTopPreviewScheme } from './palette';
import { useCodexTopPreviewState } from './previewStore';

/**
 * 读取系统浅色或深色。没有明确深色时按浅色处理，保证文字有底色。
 */
function readSystemScheme(): CodexTopPreviewScheme {
    return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/**
 * 跟随系统配色变化。样板选择固定浅色或深色时仍然监听，切回“跟随系统”时不用重新订阅。
 */
function useSystemScheme(): CodexTopPreviewScheme {
    const [scheme, setScheme] = React.useState(readSystemScheme);
    React.useEffect(() => {
        const subscription = Appearance.addChangeListener(() => {
            setScheme(readSystemScheme());
        });
        return () => subscription.remove();
    }, []);
    return scheme;
}

/**
 * 按样板外观偏好选出当前色板。跟随系统时用系统配色，否则用页面里选定的浅色或深色。
 */
export function useCodexTopPreviewPalette(): CodexTopPreviewPalette {
    const { appearance } = useCodexTopPreviewState();
    const systemScheme = useSystemScheme();
    const scheme = appearance === 'system' ? systemScheme : appearance;
    return codexTopPreviewPalettes[scheme];
}
