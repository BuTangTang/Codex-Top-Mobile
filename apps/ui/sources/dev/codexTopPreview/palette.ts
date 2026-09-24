export type CodexTopPreviewScheme = 'light' | 'dark';

export type CodexTopPreviewPalette = {
    scheme: CodexTopPreviewScheme;
    background: string;
    surface: string;
    text: string;
    meta: string;
    line: string;
    /** 指示线和强调色，沿用浅色 #0876E5、深色 #479BFF。 */
    brand: string;
    /** 小字号选中文字。浅色品牌蓝在白底上对比不足 4.5，所以文字用更深的蓝。 */
    brandText: string;
    /** 按钮上的文字色，保证和 brand 的对比达到正文要求。 */
    onBrand: string;
    userWash: string;
};

/**
 * 预览专用的浅色和深色色板。
 * 正式界面的 Unistyles 会带上主题持久化，这个样板不能引用它，所以颜色只放在这一处。
 */
export const codexTopPreviewPalettes: Readonly<Record<CodexTopPreviewScheme, CodexTopPreviewPalette>> = {
    light: {
        scheme: 'light',
        background: '#F5F5F5',
        surface: '#FFFFFF',
        text: '#1A1A1A',
        meta: '#5C6570',
        line: '#E4E4E7',
        brand: '#0876E5',
        brandText: '#0757B5',
        onBrand: '#FFFFFF',
        userWash: '#E7F1FC',
    },
    dark: {
        scheme: 'dark',
        background: '#1C1C1E',
        surface: '#2C2C2E',
        text: '#F2F2F7',
        meta: '#AEAEB2',
        line: '#3A3A3C',
        brand: '#479BFF',
        brandText: '#479BFF',
        onBrand: '#1C1C1E',
        userWash: '#1A3348',
    },
};

export const codexTopPreviewHitSize = 48;

export const codexTopPreviewType = {
    title: 17,
    body: 15,
    meta: 13,
    tab: 12,
    lineTitle: 22,
    lineBody: 20,
    lineMeta: 18,
} as const;
