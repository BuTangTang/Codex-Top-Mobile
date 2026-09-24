import * as React from 'react';
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { codexTopPreviewType } from './palette';

type PreviewTextVariant = 'title' | 'body' | 'meta' | 'tab';

const variantStyle: Record<PreviewTextVariant, TextStyle> = {
    title: { fontSize: codexTopPreviewType.title, lineHeight: codexTopPreviewType.lineTitle, fontWeight: '600' },
    body: { fontSize: codexTopPreviewType.body, lineHeight: codexTopPreviewType.lineBody, fontWeight: '400' },
    meta: { fontSize: codexTopPreviewType.meta, lineHeight: codexTopPreviewType.lineMeta, fontWeight: '400' },
    tab: { fontSize: codexTopPreviewType.tab, lineHeight: codexTopPreviewType.lineMeta, fontWeight: '600' },
};

/**
 * 预览文字。开启系统字体放大，最大到两倍，避免紧凑列表在放大后把字裁掉。
 */
export function CodexTopPreviewText(props: TextProps & { variant?: PreviewTextVariant; style?: StyleProp<TextStyle> }) {
    const { variant = 'body', style, ...rest } = props;
    return (
        <Text
            allowFontScaling
            maxFontSizeMultiplier={2}
            {...rest}
            style={[variantStyle[variant], style]}
        />
    );
}
